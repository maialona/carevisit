from __future__ import annotations

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


# --- Organization ---
class OrganizationResponse(BaseModel):
    id: uuid.UUID
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


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
    record_id: Optional[uuid.UUID] = None


class RefineResponse(BaseModel):
    refined_text: str
    tokens_used: int


class CheckGapsRequest(BaseModel):
    text: str
    visit_type: Literal["home", "phone"]


class GapItem(BaseModel):
    section: str
    hint: str


class CheckGapsResponse(BaseModel):
    gaps: List[GapItem]


# --- Client Card ---
class ClientCardResponse(BaseModel):
    case_name: str
    org_name: str
    record_count: int
    last_visit_date: datetime
