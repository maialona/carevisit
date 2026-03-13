"""
Pure-Python compliance calculation logic.
Only counts visit records with status=completed.

Rules:
- Phone compliance: current month has completed phone OR home visit → ok
  Last 7 days of month without any visit → due_soon
  Otherwise (no visit yet, still early) → ok (not overdue until month ends)
- Home compliance: last completed home visit within 90 days → ok
  Within 7 days of 90-day deadline → due_soon
  Beyond 90 days or never visited → overdue
- overall_status = worst of phone_status and home_status
"""

from datetime import date, timedelta
from typing import Optional

from app.schemas.schemas import ComplianceStatus, VisitComplianceDetail


def _phone_compliance(
    last_phone: Optional[date],
    last_home: Optional[date],
    today: date,
) -> VisitComplianceDetail:
    """Compute monthly phone-visit compliance."""
    month_start = today.replace(day=1)
    # Last day of current month
    if today.month == 12:
        month_end = today.replace(year=today.year + 1, month=1, day=1) - timedelta(days=1)
    else:
        month_end = today.replace(month=today.month + 1, day=1) - timedelta(days=1)

    # Check if there's a completed visit (phone or home) this month
    def this_month(d: Optional[date]) -> bool:
        return d is not None and d >= month_start and d <= today

    if this_month(last_phone) or this_month(last_home):
        last = max(
            (d for d in [last_phone, last_home] if this_month(d)),
            default=None,
        )
        return VisitComplianceDetail(
            status=ComplianceStatus.ok,
            last_date=last,
            due_by=month_end,
        )

    days_until_end = (month_end - today).days
    if days_until_end <= 7:
        return VisitComplianceDetail(
            status=ComplianceStatus.due_soon,
            last_date=None,
            due_by=month_end,
        )

    # No visit yet, but still has time this month
    return VisitComplianceDetail(
        status=ComplianceStatus.pending,
        last_date=None,
        due_by=month_end,
    )


def _home_compliance(
    last_home: Optional[date],
    today: date,
) -> VisitComplianceDetail:
    """Compute 90-day rolling home-visit compliance."""
    if last_home is None:
        return VisitComplianceDetail(
            status=ComplianceStatus.overdue,
            last_date=None,
            due_by=None,
        )

    due_by = last_home + timedelta(days=90)
    days_remaining = (due_by - today).days

    if days_remaining < 0:
        return VisitComplianceDetail(
            status=ComplianceStatus.overdue,
            last_date=last_home,
            due_by=due_by,
        )
    if days_remaining <= 7:
        return VisitComplianceDetail(
            status=ComplianceStatus.due_soon,
            last_date=last_home,
            due_by=due_by,
        )
    return VisitComplianceDetail(
        status=ComplianceStatus.ok,
        last_date=last_home,
        due_by=due_by,
    )


_STATUS_ORDER = {
    ComplianceStatus.ok: 0,
    ComplianceStatus.pending: 1,
    ComplianceStatus.no_record: 2,
    ComplianceStatus.due_soon: 3,
    ComplianceStatus.overdue: 4,
}


def compute_compliance(
    last_phone_date: Optional[date],
    last_home_date: Optional[date],
    today: Optional[date] = None,
) -> tuple[VisitComplianceDetail, VisitComplianceDetail, ComplianceStatus]:
    """
    Returns (phone_detail, home_detail, overall_status).
    today defaults to date.today() if not provided.
    """
    if today is None:
        today = date.today()

    # Case has absolutely no completed records of any type
    if last_phone_date is None and last_home_date is None:
        no_rec = VisitComplianceDetail(status=ComplianceStatus.no_record)
        return no_rec, no_rec, ComplianceStatus.no_record

    phone = _phone_compliance(last_phone_date, last_home_date, today)
    home = _home_compliance(last_home_date, today)

    overall = max(
        [phone.status, home.status],
        key=lambda s: _STATUS_ORDER[s],
    )
    return phone, home, overall
