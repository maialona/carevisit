import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.models.models import User

security_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials
    payload = decode_token(token)

    if payload is None:
        print(f"Auth loop bug: decode_token returned None for token {token[:10]}...")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="無效的認證憑證",
        )
    if payload.get("type") != "access":
        print(f"Auth loop bug: payload type is not access. payload={payload}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="無效的認證憑證",
        )

    user_id = payload.get("sub")
    if user_id is None:
        print("Auth loop bug: user_id is None in payload")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="無效的認證憑證",
        )

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()

    if user is None:
        print(f"Auth loop bug: user not found for user_id={user_id}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="使用者不存在或已停用",
        )
    if not user.is_active:
        print(f"Auth loop bug: user {user_id} is inactive")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="使用者不存在或已停用",
        )

    return user


async def require_admin(
    current_user: User = Depends(get_current_user)
) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="此操作需要管理員權限"
        )
    return current_user


async def require_same_org(
    target_org_id: uuid.UUID,
    current_user: User = Depends(get_current_user)
) -> User:
    """確保只能存取同機構資料"""
    if current_user.org_id != target_org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="無法存取其他機構的資料"
        )
    return current_user


def check_record_owner_or_admin(
    record: "VisitRecord",
    current_user: User
) -> None:
    """紀錄只有本人或 admin 可編輯/刪除"""
    if current_user.role != "admin" and record.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只能編輯或刪除自己的紀錄"
        )
