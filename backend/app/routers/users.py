from __future__ import annotations

import string
import secrets
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import hash_password, verify_password
from app.deps import get_current_user, require_admin
from app.models.models import AuditActionType, User, UserRole, VisitRecord
from app.routers.audit_utils import log_action
from app.schemas.schemas import (
    ChangePasswordRequest,
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
        avatar=user.avatar,
        is_active=user.is_active,
        created_at=user.created_at,
        last_record_date=last_record_date,
        record_count=record_count,
    )


# ── /me routes (must be defined before /{user_id} to avoid route conflicts) ──

@router.put("/me/password", status_code=status.HTTP_200_OK)
async def change_my_password(
    body: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="目前密碼不正確")
    current_user.hashed_password = hash_password(body.new_password)
    await db.flush()
    return {"message": "密碼已更新"}


@router.put("/me/avatar", response_model=UserResponse)
async def update_my_avatar(
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.avatar is None:
        raise HTTPException(status_code=400, detail="請提供頭像圖片名稱")

    current_user.avatar = body.avatar
    await db.flush()
    return current_user


@router.put("/me", response_model=UserResponse)
async def update_my_profile(
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="名稱不能為空")
        current_user.name = body.name.strip()
    await db.flush()
    return current_user


# ── Admin-only routes ──

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
    await log_action(db, current_user, AuditActionType.user_create, "user",
                     resource_id=str(user.id), resource_label=user.email)
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
    await log_action(db, current_user, AuditActionType.user_update, "user",
                     resource_id=str(user.id), resource_label=user.email)
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
    await log_action(db, current_user, AuditActionType.user_deactivate, "user",
                     resource_id=str(user.id), resource_label=user.email)
    return {"message": "該帳號已停用"}


@router.post("/{user_id}/reset-password")
async def reset_password(
    user_id: uuid.UUID,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id, User.org_id == current_user.org_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="使用者不存在")

    custom_password = body.get("password") if body else None
    if custom_password:
        if len(custom_password) < 8:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="密碼至少需要 8 個字元")
        new_password = custom_password
    else:
        alphabet = string.ascii_letters + string.digits
        new_password = "".join(secrets.choice(alphabet) for _ in range(12))

    user.hashed_password = hash_password(new_password)
    await db.flush()
    await log_action(db, current_user, AuditActionType.user_reset_pw, "user",
                     resource_id=str(user.id), resource_label=user.email)
    return {"message": "密碼已重設", "new_password": new_password}


@router.delete("/{user_id}/permanent", status_code=status.HTTP_200_OK)
async def delete_user_permanent(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能刪除自己的帳號")

    result = await db.execute(select(User).where(User.id == user_id, User.org_id == current_user.org_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="使用者不存在")

    record_count = await db.execute(
        select(func.count()).select_from(VisitRecord).where(VisitRecord.user_id == user_id)
    )
    count = record_count.scalar() or 0
    if count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"該使用者有 {count} 筆訪視紀錄，無法刪除。請改用停用功能。",
        )

    deleted_email = user.email
    deleted_id = str(user.id)
    await db.delete(user)
    await db.flush()
    await log_action(db, current_user, AuditActionType.user_delete, "user",
                     resource_id=deleted_id, resource_label=deleted_email)
    return {"message": "帳號已永久刪除"}
