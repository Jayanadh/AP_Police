"""Periods of whole days in Asia/Kolkata, the unit statements are drawn up in: a day, a week, a month, a financial
year or any range in between, at most a year long. Requests name one with `?from=YYYY-MM-DD&to=YYYY-MM-DD`, both days
included."""
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from common.exceptions import BusinessRuleError
from common.months import FIRST_YEAR, IST, LAST_YEAR, month_start, next_month, today_ist

MAX_PERIOD_DAYS = 366  # a financial year that includes 29 February
DATE_FORMAT_MESSAGE = "Use dates in the format YYYY-MM-DD."
_DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")


@dataclass(frozen=True)
class Period:
    """From `start` to `end`, both days included."""

    start: date
    end: date

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def bounds(self) -> tuple[datetime, datetime]:
        """The period as an aware Asia/Kolkata `[start, end)` range, for filtering timestamps."""
        following = self.end + timedelta(days=1)
        return (
            datetime(self.start.year, self.start.month, self.start.day, tzinfo=IST),
            datetime(following.year, following.month, following.day, tzinfo=IST),
        )

    @property
    def label(self) -> str:
        """How people say it: "03 Oct 2026", "October 2026", "FY 2026-27" or "28 Sep – 04 Oct 2026"."""
        if self.start == self.end:
            return f"{self.start:%d %b %Y}"
        if self == month_period(self.start):
            return f"{self.start:%B %Y}"
        if self.start == date(self.start.year, 4, 1) and self.end == date(self.start.year + 1, 3, 31):
            return f"FY {self.start.year}-{(self.start.year + 1) % 100:02d}"
        if self.start.year == self.end.year:
            return f"{self.start:%d %b} – {self.end:%d %b %Y}"
        return f"{self.start:%d %b %Y} – {self.end:%d %b %Y}"


def month_period(day: date) -> Period:
    """The calendar month `day` falls in."""
    first = month_start(day)
    return Period(first, next_month(first) - timedelta(days=1))


def parse_period(params: Mapping[str, str], *, default: Period | None = None) -> Period:
    """The period named by `from` and `to` in `params`. With neither, `default` (the current month unless given)."""
    raw_from = (params.get("from") or "").strip()
    raw_to = (params.get("to") or "").strip()
    if not raw_from and not raw_to:
        return default if default is not None else month_period(today_ist())
    if not raw_from or not raw_to:
        raise BusinessRuleError("Give both the first and the last day of the period.")
    return make_period(_parse_date(raw_from), _parse_date(raw_to))


def make_period(start: date, end: date) -> Period:
    """The period from `start` to `end`, refused when they are out of order, too far apart or out of range."""
    if not (FIRST_YEAR <= start.year <= LAST_YEAR and FIRST_YEAR <= end.year <= LAST_YEAR):
        raise BusinessRuleError(f"Pick dates from {FIRST_YEAR} to {LAST_YEAR}.")
    period = Period(start, end)
    if period.start > period.end:
        raise BusinessRuleError("The first day must be on or before the last day.")
    if period.days > MAX_PERIOD_DAYS:
        raise BusinessRuleError("Pick a period of at most a year.")
    return period


def _parse_date(value: str) -> date:
    if _DATE_PATTERN.fullmatch(value) is None:
        raise BusinessRuleError(DATE_FORMAT_MESSAGE)
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise BusinessRuleError(DATE_FORMAT_MESSAGE) from None
    if not FIRST_YEAR <= parsed.year <= LAST_YEAR:
        raise BusinessRuleError(DATE_FORMAT_MESSAGE)
    return parsed
