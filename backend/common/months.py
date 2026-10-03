"""Calendar months in Asia/Kolkata, the unit every fuel limit, statement and report is counted in."""
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from common.exceptions import BusinessRuleError

IST = ZoneInfo("Asia/Kolkata")
MONTH_FORMAT_MESSAGE = "Use the month format YYYY-MM."
_MONTH_PATTERN = re.compile(r"(\d{4})-(0[1-9]|1[0-2])")
FIRST_YEAR, LAST_YEAR = 2000, 2100  # a typo such as 9999-12 would overflow `date` in `next_month`


def today_ist() -> date:
    """Today's date in Asia/Kolkata."""
    return timezone.now().astimezone(IST).date()


def current_month() -> date:
    """The first day of the current month in Asia/Kolkata."""
    return month_start(today_ist())


def month_start(day: date) -> date:
    return day.replace(day=1)


def next_month(first: date) -> date:
    return date(first.year + 1, 1, 1) if first.month == 12 else date(first.year, first.month + 1, 1)


def month_bounds(first: date) -> tuple[datetime, datetime]:
    """The month as an aware Asia/Kolkata `[start, end)` range, for filtering timestamps."""
    following = next_month(first)
    return (
        datetime(first.year, first.month, 1, tzinfo=IST),
        datetime(following.year, following.month, 1, tzinfo=IST),
    )


def day_bounds(day: date) -> tuple[datetime, datetime]:
    """The day as an aware Asia/Kolkata `[start, end)` range, for filtering timestamps."""
    start = datetime(day.year, day.month, day.day, tzinfo=IST)
    return start, start + timedelta(days=1)  # Asia/Kolkata has no daylight saving: every day is 24 hours


def parse_month(value: str | None) -> date:
    """`"YYYY-MM"` to the first day of that month. Missing or empty means the current month."""
    if value is None or not value.strip():
        return current_month()
    match = _MONTH_PATTERN.fullmatch(value.strip())
    if match is None or not FIRST_YEAR <= int(match.group(1)) <= LAST_YEAR:
        raise BusinessRuleError(MONTH_FORMAT_MESSAGE)
    return date(int(match.group(1)), int(match.group(2)), 1)


def format_month(first: date) -> str:
    return f"{first.year:04d}-{first.month:02d}"
