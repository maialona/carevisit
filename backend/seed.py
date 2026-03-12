"""Seed script — inserts test organization + admin/supervisor accounts."""
import asyncio

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session, engine, Base
from app.core.security import hash_password
from app.models.models import Organization, User, UserRole


async def seed() -> None:
    # Create tables if they don't exist (for quick dev setup)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Add avatar column if missing (for databases created before avatar feature)
    async with engine.begin() as conn:
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(50)"
        ))

    async with async_session() as session:  # type: AsyncSession
        # Check if already seeded
        result = await session.execute(select(Organization).limit(1))
        if result.scalar_one_or_none() is not None:
            print("資料庫已有資料，跳過 seed。")
            return

        org = Organization(name="台北長照機構")
        session.add(org)
        await session.flush()  # get org.id

        admin = User(
            org_id=org.id,
            name="系統管理員",
            email="admin@test.com",
            hashed_password=hash_password("admin1234"),
            role=UserRole.admin,
        )
        supervisor = User(
            org_id=org.id,
            name="督導員",
            email="user@test.com",
            hashed_password=hash_password("user1234"),
            role=UserRole.supervisor,
        )
        session.add_all([admin, supervisor])
        await session.commit()
        print("Seed 完成！已建立測試機構與 2 個帳號。")


if __name__ == "__main__":
    asyncio.run(seed())
