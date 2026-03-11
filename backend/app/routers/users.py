from __future__ import annotations

import string
import secrets
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import hash_password
from app.deps import get_current_user, require_admin
from app.models.models import User, UserRole, VisitRecord
from app.schemas.schemas import (
    UserCreate,
    UserResponse,
    UserUpdate,
    UserWithStatsResponse,
)

router = APIRouter(prefix="/users", tags=["users"])


async def _enrich_user(user: User, db: AsyncSession) -> UserWithStatsResponse:
    count_q = select(func.count()).select_from(VisitRecord).where(VisitRecord.user_id == user.id)
    latest_q = select(func.max(VisitRecord.visit_date)).where(VisitRecord.user_id == user.id)
    count_result = await db.execute(count_q)
    latest_result = await db.execute(latest_q)
    record_count = count_result.scalar() or 0
    last_record_date = latest_result.scalar()
    
    return UserWithStatsResponse(
        id=user.id,
        org_id=user.org_id,
        name=user.name,
        email=user.email,
        role=user.role.value,
        is_active=user.is_active,
        created_at=user.created_at,
        last_record_date=last_record_date,
        record_count=record_count,
    )


@router.get("", response_model=List[UserWithStatsResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(
        select(User).where(User.org_id == current_user.org_id).order_by(User.created_at.desc())
    )
    users = result.scalars().all()
    return [await _enrich_user(u, db) for u in users]


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    # Check if user email exists
    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="該 Email 已被使用")

    user = User(
        org_id=current_user.org_id,
        name=body.name,
        email=body.email,
        hashed_password=hash_password(body.password),
        role=UserRole(body.role),
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id, User.org_id == current_user.org_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="使用者不存在")

    update_data = body.model_dump(exclude_unset=True)
    if "role" in update_data:
        update_data["role"] = UserRole(update_data["role"])
    
    for field, value in update_data.items():
        setattr(user, field, value)

    await db.flush()
    return user


@router.delete("/{user_id}", status_code=status.HTTP_200_OK)
async def deactivate_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能停用自己的帳號")

    result = await db.execute(select(User).where(User.id == user_id, User.org_id == current_user.org_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="使用者不存在")

    user.is_active = False
    await db.flush()
    return {"message": "該帳號已停用"}


@router.post("/{user_id}/reset-password")
async def reset_password(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id, User.org_id == current_user.org_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="使用者不存在")

    alphabet = string.ascii_letters + string.digits
    new_password = "".join(secrets.choice(alphabet) for _ in range(12))
    user.hashed_password = hash_password(new_password)
    await db.flush()
    
    return {"message": "密碼已重設", "new_password": new_password}
