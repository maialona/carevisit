import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.types import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


class UserRole(str, enum.Enum):
    admin = "admin"
    supervisor = "supervisor"



class VisitType(str, enum.Enum):
    home = "home"
    phone = "phone"


class OutputFormat(str, enum.Enum):
    bullet = "bullet"
    narrative = "narrative"


class RecordStatus(str, enum.Enum):
    draft = "draft"
    completed = "completed"


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    users: Mapped[list["User"]] = relationship(back_populates="organization")
    case_profiles: Mapped[list["CaseProfile"]] = relationship(back_populates="organization")

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.supervisor)
    avatar: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    organization: Mapped["Organization"] = relationship(back_populates="users")
    visit_records: Mapped[list["VisitRecord"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    chat_sessions: Mapped[list["ChatSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")

class VisitRecord(Base):
    __tablename__ = "visit_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    case_name: Mapped[str] = mapped_column(String(100), nullable=False)
    org_name: Mapped[str] = mapped_column(String(200), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    visit_type: Mapped[VisitType] = mapped_column(Enum(VisitType), nullable=False)
    visit_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    raw_input: Mapped[str] = mapped_column(Text, default="")
    refined_content: Mapped[str] = mapped_column(Text, default="")
    output_format: Mapped[OutputFormat] = mapped_column(Enum(OutputFormat), default=OutputFormat.bullet)
    auto_refine: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[RecordStatus] = mapped_column(Enum(RecordStatus), default=RecordStatus.draft)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    case_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("case_profiles.id"), nullable=True
    )

    user: Mapped["User"] = relationship(back_populates="visit_records")
    refinement_logs: Mapped[list["RefinementLog"]] = relationship(back_populates="record", cascade="all, delete-orphan")


class RefinementLog(Base):
    __tablename__ = "refinement_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    record_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("visit_records.id"), nullable=False)
    input_text: Mapped[str] = mapped_column(Text, nullable=False)
    output_text: Mapped[str] = mapped_column(Text, nullable=False)
    format_type: Mapped[str] = mapped_column(String(50), nullable=False)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    record: Mapped["VisitRecord"] = relationship(back_populates="refinement_logs")


class CaseProfile(Base):
    __tablename__ = "case_profiles"
    __table_args__ = (UniqueConstraint("org_id", "id_number"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    id_number: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    supervisor: Mapped[str | None] = mapped_column(String(100), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(10), nullable=True)
    service_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    district: Mapped[str | None] = mapped_column(String(50), nullable=True)
    road: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    organization: Mapped["Organization"] = relationship(back_populates="case_profiles")
    visit_schedule: Mapped["VisitSchedule | None"] = relationship(back_populates="case_profile", uselist=False)


class VisitSchedule(Base):
    __tablename__ = "visit_schedules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    case_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("case_profiles.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True
    )
    preferred_day_of_month: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-28
    reminder_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    case_profile: Mapped["CaseProfile"] = relationship(back_populates="visit_schedule")


class MonthlyVisitSchedule(Base):
    __tablename__ = "monthly_visit_schedules"
    __table_args__ = (UniqueConstraint("case_profile_id", "year", "month"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    case_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("case_profiles.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)   # 1–12
    preferred_day: Mapped[int] = mapped_column(Integer, nullable=False)  # 1–28
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    messages: Mapped[dict] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user: Mapped["User"] = relationship(back_populates="chat_sessions")
