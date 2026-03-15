from __future__ import annotations

import enum
import math
import uuid
from datetime import date, datetime
from typing import Generic, List, Literal, Optional, TypeVar

from pydantic import BaseModel, EmailStr

T = TypeVar("T")


# --- Auth ---
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# --- User ---
class UserResponse(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    email: str
    role: str
    avatar: Optional[str] = None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserWithStatsResponse(UserResponse):
    last_record_date: Optional[datetime] = None
    record_count: int = 0


from pydantic import constr

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: constr(min_length=8)
    role: Literal["admin", "supervisor"]


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["admin", "supervisor"]] = None
    avatar: Optional[str] = None
    is_active: Optional[bool] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: constr(min_length=8)


# --- Organization ---
class OrganizationResponse(BaseModel):
    id: uuid.UUID
    name: str
    supervisor_can_create_case: bool = False
    supervisor_can_delete_case: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class OrgSettingsUpdate(BaseModel):
    supervisor_can_create_case: Optional[bool] = None
    supervisor_can_delete_case: Optional[bool] = None


# --- Paginated ---
class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int
    total_pages: int

    @staticmethod
    def compute_total_pages(total: int, page_size: int) -> int:
        return max(1, math.ceil(total / page_size))



# --- VisitRecord (brief, for case detail) ---
class VisitRecordBrief(BaseModel):
    id: uuid.UUID
    case_name: str
    org_name: str
    user_id: uuid.UUID
    user_name: str = ""
    visit_type: str
    visit_date: datetime
    raw_input: str
    refined_content: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# --- VisitRecord CRUD ---
class VisitRecordCreate(BaseModel):
    case_name: str
    org_name: str
    visit_type: Literal["home", "phone"]
    visit_date: date
    raw_input: str = ""
    refined_content: str = ""
    output_format: Literal["bullet", "narrative"] = "bullet"
    auto_refine: bool = False
    status: Literal["draft", "completed"] = "draft"
    case_profile_id: Optional[uuid.UUID] = None


class VisitRecordUpdate(BaseModel):
    visit_date: Optional[date] = None
    raw_input: Optional[str] = None
    refined_content: Optional[str] = None
    output_format: Optional[str] = None
    auto_refine: Optional[bool] = None
    status: Optional[str] = None


class VisitRecordResponse(BaseModel):
    id: uuid.UUID
    case_name: str
    org_name: str
    user_id: uuid.UUID
    user_name: str = ""
    visit_type: str
    visit_date: datetime
    raw_input: str
    refined_content: str
    output_format: str
    auto_refine: bool
    status: str
    created_at: datetime
    updated_at: datetime
    case_profile_id: Optional[uuid.UUID] = None

    model_config = {"from_attributes": True}


# --- AI ---
class TranscribeResponse(BaseModel):
    text: str
    duration: float


class OcrResponse(BaseModel):
    text: str


class RefineRequest(BaseModel):
    text: str
    format: Literal["bullet", "narrative"]
    visit_type: Literal["home", "phone"]
    tone: Literal["professional", "warm", "concise", "detailed"] = "professional"
    record_id: Optional[uuid.UUID] = None


class RefineResponse(BaseModel):
    refined_text: str
    tokens_used: int


class RefineSectionRequest(BaseModel):
    section_html: str
    context: str = ""
    format: Literal["bullet", "narrative"]
    visit_type: Literal["home", "phone"]
    tone: Literal["professional", "warm", "concise", "detailed"] = "professional"


class RefineSectionResponse(BaseModel):
    refined_html: str
    tokens_used: int


class CheckGapsRequest(BaseModel):
    text: str
    visit_type: Literal["home", "phone"]


class GapItem(BaseModel):
    section: str
    hint: str


class CheckGapsResponse(BaseModel):
    gaps: List[GapItem]


# --- CaseProfile ---
class CaseProfileOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    id_number: str
    name: str
    supervisor: Optional[str] = None
    gender: Optional[str] = None
    service_status: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    district: Optional[str] = None
    road: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CaseProfileCreate(BaseModel):
    id_number: str
    name: str
    supervisor: Optional[str] = None
    gender: Optional[str] = None
    service_status: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    district: Optional[str] = None
    road: Optional[str] = None


class CaseProfileUpdate(BaseModel):
    name: Optional[str] = None
    supervisor: Optional[str] = None
    gender: Optional[str] = None
    service_status: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    district: Optional[str] = None
    road: Optional[str] = None


class ImportPreviewRow(BaseModel):
    id_number: str
    name: str
    supervisor: Optional[str] = None
    gender: Optional[str] = None
    service_status: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    district: Optional[str] = None
    road: Optional[str] = None
    action: Literal["create", "update"]


class ImportPreviewResponse(BaseModel):
    rows: List[ImportPreviewRow]
    create_count: int
    update_count: int
    error_rows: List[dict]


class ImportConfirmRequest(BaseModel):
    rows: List[ImportPreviewRow]


class ImportConfirmResponse(BaseModel):
    created: int
    updated: int
    errors: int


# --- Schedule & Compliance ---
class ComplianceStatus(str, enum.Enum):
    ok = "ok"
    pending = "pending"       # no visit yet this month, but still has time
    no_record = "no_record"   # case has zero completed records of any type
    due_soon = "due_soon"
    overdue = "overdue"


class VisitScheduleUpsert(BaseModel):
    preferred_day_of_month: Optional[int] = None
    reminder_enabled: bool = True


class VisitScheduleResponse(BaseModel):
    id: uuid.UUID
    case_profile_id: uuid.UUID
    preferred_day_of_month: Optional[int] = None
    reminder_enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class VisitComplianceDetail(BaseModel):
    status: ComplianceStatus
    last_date: Optional[date] = None
    due_by: Optional[date] = None


class CaseComplianceItem(BaseModel):
    case_profile_id: uuid.UUID
    case_name: str
    id_number: str
    supervisor: Optional[str] = None
    phone_compliance: VisitComplianceDetail
    home_compliance: VisitComplianceDetail
    overall_status: ComplianceStatus
    schedule: Optional[VisitScheduleResponse] = None


class ComplianceSummary(BaseModel):
    ok: int
    pending: int
    no_record: int
    due_soon: int
    overdue: int
    total: int


class MonthlyScheduleUpsert(BaseModel):
    preferred_day: int  # 1–28


class MonthlyScheduleResponse(BaseModel):
    year: int
    month: int
    preferred_day: int

    model_config = {"from_attributes": True}


class ComplianceListParams(BaseModel):
    page: int = 1
    page_size: int = 20
    search: Optional[str] = None
    status_filter: Optional[ComplianceStatus] = None


# --- Client Card ---
class ClientCardResponse(BaseModel):
    case_name: str
    org_name: str
    record_count: int
    last_visit_date: datetime
