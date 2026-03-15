from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps import get_current_user, require_admin
from app.models.models import AuditActionType, CaseProfile, User, UserRole, utcnow
from app.routers.audit_utils import log_action
from app.schemas.schemas import (
    CaseProfileCreate,
    CaseProfileOut,
    CaseProfileUpdate,
    ImportConfirmRequest,
    ImportConfirmResponse,
    ImportPreviewResponse,
    ImportPreviewRow,
    PaginatedResponse,
)

router = APIRouter(prefix="/case-profiles", tags=["case-profiles"])


def _require_create_perm(user: User) -> None:
    if user.role != UserRole.admin and not user.can_create_case:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="此操作需要管理員權限")


def _require_delete_perm(user: User) -> None:
    if user.role != UserRole.admin and not user.can_delete_case:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="此操作需要管理員權限")

COLUMN_MAP = {
    "姓名": "name",
    "居督": "supervisor",
    "身分證字號": "id_number",
    "性別": "gender",
    "服務狀態": "service_status",
    "手機": "phone",
    "通訊地址": "address",
    "通訊鄉鎮區": "district",
    "通訊路段": "road",
}


@router.get("/search", response_model=List[str])
async def search_names(
    q: str = Query("", min_length=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not q:
        return []
    result = await db.execute(
        select(CaseProfile.name)
        .where(CaseProfile.org_id == current_user.org_id)
        .where(CaseProfile.name.ilike(f"%{q}%"))
        .order_by(CaseProfile.name)
        .limit(10)
    )
    return result.scalars().all()


@router.get("", response_model=PaginatedResponse[CaseProfileOut])
async def list_case_profiles(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    service_status: Optional[str] = Query(None),
    supervisor: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(CaseProfile).where(CaseProfile.org_id == current_user.org_id)
    count_q = select(func.count()).select_from(CaseProfile).where(CaseProfile.org_id == current_user.org_id)

    if search:
        like = f"%{search}%"
        filter_clause = or_(CaseProfile.name.ilike(like), CaseProfile.id_number.ilike(like))
        q = q.where(filter_clause)
        count_q = count_q.where(filter_clause)

    if service_status:
        q = q.where(CaseProfile.service_status == service_status)
        count_q = count_q.where(CaseProfile.service_status == service_status)

    if supervisor:
        q = q.where(CaseProfile.supervisor == supervisor)
        count_q = count_q.where(CaseProfile.supervisor == supervisor)

    total = (await db.execute(count_q)).scalar() or 0
    offset = (page - 1) * page_size
    result = await db.execute(q.order_by(CaseProfile.name).offset(offset).limit(page_size))
    items = result.scalars().all()

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=PaginatedResponse.compute_total_pages(total, page_size),
    )


@router.get("/{case_profile_id}", response_model=CaseProfileOut)
async def get_case_profile(
    case_profile_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(CaseProfile).where(
            CaseProfile.id == case_profile_id,
            CaseProfile.org_id == current_user.org_id,
        )
    )
    case = result.scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="個案不存在")
    return case


@router.post("", response_model=CaseProfileOut, status_code=status.HTTP_201_CREATED)
async def create_case_profile(
    body: CaseProfileCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_create_perm(current_user)
    existing = await db.execute(
        select(CaseProfile).where(
            CaseProfile.org_id == current_user.org_id,
            CaseProfile.id_number == body.id_number,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="該身分證字號已存在")

    case = CaseProfile(org_id=current_user.org_id, **body.model_dump())
    db.add(case)
    await db.flush()
    await log_action(db, current_user, AuditActionType.case_create, "case_profile",
                     resource_id=str(case.id), resource_label=case.name)
    return case


@router.put("/{case_id}", response_model=CaseProfileOut)
async def update_case_profile(
    case_id: uuid.UUID,
    body: CaseProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_create_perm(current_user)
    result = await db.execute(
        select(CaseProfile).where(CaseProfile.id == case_id, CaseProfile.org_id == current_user.org_id)
    )
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="個案不存在")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(case, field, value)

    await db.flush()
    await log_action(db, current_user, AuditActionType.case_update, "case_profile",
                     resource_id=str(case.id), resource_label=case.name)
    return case


@router.delete("/batch", status_code=status.HTTP_200_OK)
async def batch_delete_case_profiles(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_delete_perm(current_user)
    ids = [uuid.UUID(i) for i in body.get("ids", [])]
    if not ids:
        raise HTTPException(status_code=400, detail="未提供 ID 列表")

    result = await db.execute(
        select(CaseProfile).where(
            CaseProfile.id.in_(ids),
            CaseProfile.org_id == current_user.org_id,
        )
    )
    cases = result.scalars().all()
    for case in cases:
        await db.delete(case)
    await db.flush()
    await log_action(db, current_user, AuditActionType.case_delete, "case_profile",
                     detail={"count": len(cases)})
    return {"deleted": len(cases)}


@router.delete("/{case_id}", status_code=status.HTTP_200_OK)
async def delete_case_profile(
    case_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_delete_perm(current_user)
    result = await db.execute(
        select(CaseProfile).where(CaseProfile.id == case_id, CaseProfile.org_id == current_user.org_id)
    )
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="個案不存在")

    case_label = case.name
    case_id_str = str(case.id)
    await db.delete(case)
    await db.flush()
    await log_action(db, current_user, AuditActionType.case_delete, "case_profile",
                     resource_id=case_id_str, resource_label=case_label)
    return {"message": "已刪除"}


@router.post("/import/preview", response_model=ImportPreviewResponse)
async def import_preview(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_create_perm(current_user)
    if not file.filename or not (file.filename.endswith(".xlsx") or file.filename.endswith(".xls")):
        raise HTTPException(status_code=400, detail="請上傳 .xlsx 或 .xls 檔案")

    try:
        import io
        content = await file.read()
        is_xls = file.filename.endswith(".xls")
        all_rows: list[list] = []

        if is_xls:
            import xlrd
            wb = xlrd.open_workbook(file_contents=content)
            ws = wb.sheet_by_index(0)
            all_rows = [[ws.cell_value(r, c) for c in range(ws.ncols)] for r in range(ws.nrows)]
        else:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            ws = wb.active
            all_rows = [list(row) for row in ws.iter_rows(values_only=True)]

        if not all_rows:
            raise HTTPException(status_code=400, detail="Excel 檔案為空")

        header_row = all_rows[0]
        headers = [str(h).strip() if h is not None else "" for h in header_row]
        col_index: dict[str, int] = {}
        for i, h in enumerate(headers):
            if h in COLUMN_MAP:
                col_index[COLUMN_MAP[h]] = i

        if "id_number" not in col_index or "name" not in col_index:
            raise HTTPException(status_code=400, detail="Excel 缺少必要欄位：姓名 或 身分證字號")

        parsed_rows: list[dict] = []
        error_rows: list[dict] = []

        for row in all_rows[1:]:
            def get(field: str, _row: list = row) -> str | None:
                idx = col_index.get(field)
                if idx is None or idx >= len(_row):
                    return None
                val = _row[idx]
                return str(val).strip() if val is not None and str(val).strip() else None

            id_number = get("id_number")
            name = get("name")

            if not id_number:
                error_rows.append({"name": name or "", "reason": "缺少身分證字號"})
                continue

            parsed_rows.append({
                "id_number": id_number,
                "name": name or "",
                "supervisor": get("supervisor"),
                "gender": get("gender"),
                "service_status": get("service_status"),
                "phone": get("phone"),
                "address": get("address"),
                "district": get("district"),
                "road": get("road"),
            })

        # Check existing id_numbers
        id_numbers = [r["id_number"] for r in parsed_rows]
        existing_result = await db.execute(
            select(CaseProfile.id_number).where(
                CaseProfile.org_id == current_user.org_id,
                CaseProfile.id_number.in_(id_numbers),
            )
        )
        existing_ids = set(existing_result.scalars().all())

        preview_rows: list[ImportPreviewRow] = []
        for r in parsed_rows:
            action = "update" if r["id_number"] in existing_ids else "create"
            preview_rows.append(ImportPreviewRow(action=action, **r))

        create_count = sum(1 for r in preview_rows if r.action == "create")
        update_count = sum(1 for r in preview_rows if r.action == "update")

        return ImportPreviewResponse(
            rows=preview_rows,
            create_count=create_count,
            update_count=update_count,
            error_rows=error_rows,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"解析 Excel 失敗：{str(e)}")


@router.post("/import/confirm", response_model=ImportConfirmResponse)
async def import_confirm(
    body: ImportConfirmRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_create_perm(current_user)
    created = 0
    updated = 0
    errors = 0

    for row in body.rows:
        try:
            stmt = (
                pg_insert(CaseProfile)
                .values(
                    org_id=current_user.org_id,
                    id_number=row.id_number,
                    name=row.name,
                    supervisor=row.supervisor,
                    gender=row.gender,
                    service_status=row.service_status,
                    phone=row.phone,
                    address=row.address,
                    district=row.district,
                    road=row.road,
                )
                .on_conflict_do_update(
                    constraint="case_profiles_org_id_id_number_key",
                    set_={
                        "name": row.name,
                        "supervisor": row.supervisor,
                        "gender": row.gender,
                        "service_status": row.service_status,
                        "phone": row.phone,
                        "address": row.address,
                        "district": row.district,
                        "road": row.road,
                        "updated_at": utcnow(),
                    },
                )
            )
            result = await db.execute(stmt)
            if result.rowcount == 1 and row.action == "create":
                created += 1
            else:
                updated += 1
        except Exception:
            errors += 1

    await db.flush()
    await log_action(db, current_user, AuditActionType.case_import, "case_profile",
                     detail={"created": created, "updated": updated, "errors": errors})
    return ImportConfirmResponse(created=created, updated=updated, errors=errors)
