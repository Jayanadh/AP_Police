from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from common import months
from common.exceptions import BusinessRuleError

IST = ZoneInfo("Asia/Kolkata")
FORMAT_MESSAGE = "Use the month format YYYY-MM."


def test_parse_month_returns_the_first_day():
    assert months.parse_month("2026-02") == date(2026, 2, 1)


@pytest.mark.parametrize("value", ["2026-13", "2026-00", "2026-2", "26-02", "2026/02", "2026-02-01", "feb 2026", "abc"])
def test_parse_month_refuses_anything_but_yyyy_mm(value):
    with pytest.raises(BusinessRuleError) as error:
        months.parse_month(value)
    assert str(error.value.detail) == FORMAT_MESSAGE


@pytest.mark.parametrize("value", ["9999-12", "2101-01", "1999-12", "0000-05", "0001-01"])
def test_parse_month_refuses_years_outside_2000_to_2100(value):
    with pytest.raises(BusinessRuleError) as error:
        months.parse_month(value)
    assert str(error.value.detail) == FORMAT_MESSAGE


def test_parse_month_accepts_the_edges_of_the_year_range():
    assert months.parse_month("2000-01") == date(2000, 1, 1)
    assert months.parse_month("2100-12") == date(2100, 12, 1)
    start, end = months.month_bounds(months.parse_month("2100-12"))  # no overflow at the top edge
    assert end == datetime(2101, 1, 1, 0, 0, tzinfo=IST)


@pytest.mark.parametrize("value", [None, "", "   "])
def test_parse_month_defaults_to_the_current_month(value):
    assert months.parse_month(value) == months.current_month()


def test_format_month_round_trips():
    assert months.format_month(date(2026, 3, 1)) == "2026-03"
    assert months.parse_month(months.format_month(date(2027, 11, 1))) == date(2027, 11, 1)


def test_month_start_drops_the_day():
    assert months.month_start(date(2026, 10, 17)) == date(2026, 10, 1)
    assert months.month_start(date(2026, 10, 1)) == date(2026, 10, 1)


def test_next_month_rolls_over_the_year():
    assert months.next_month(date(2026, 12, 1)) == date(2027, 1, 1)
    assert months.next_month(date(2026, 2, 1)) == date(2026, 3, 1)


def test_month_bounds_are_aware_asia_kolkata_midnights():
    start, end = months.month_bounds(date(2026, 10, 1))
    assert start == datetime(2026, 10, 1, 0, 0, tzinfo=IST)
    assert end == datetime(2026, 11, 1, 0, 0, tzinfo=IST)
    assert start.utcoffset().total_seconds() == 5.5 * 3600
    assert end.utcoffset().total_seconds() == 5.5 * 3600


def test_month_bounds_of_december_end_in_january():
    start, end = months.month_bounds(date(2026, 12, 1))
    assert end == datetime(2027, 1, 1, 0, 0, tzinfo=IST)


def test_current_month_is_the_calendar_month_in_asia_kolkata(monkeypatch):
    # 20:00 UTC on 30 September is already 01:30 on 1 October in Kolkata.
    late_utc = datetime(2026, 9, 30, 20, 0, tzinfo=ZoneInfo("UTC"))
    monkeypatch.setattr(timezone, "now", lambda: late_utc)
    assert months.current_month() == date(2026, 10, 1)


def test_today_ist_is_the_calendar_date_in_asia_kolkata(monkeypatch):
    # 20:00 UTC on 3 October is already 01:30 on Sunday 4 October in Kolkata.
    late_utc = datetime(2026, 10, 3, 20, 0, tzinfo=ZoneInfo("UTC"))
    monkeypatch.setattr(timezone, "now", lambda: late_utc)
    assert months.today_ist() == date(2026, 10, 4)


def test_day_bounds_are_aware_asia_kolkata_midnights():
    start, end = months.day_bounds(date(2026, 10, 15))
    assert start == datetime(2026, 10, 15, 0, 0, tzinfo=IST)
    assert end == datetime(2026, 10, 16, 0, 0, tzinfo=IST)


def test_day_bounds_of_the_last_day_of_a_year_end_on_new_year():
    start, end = months.day_bounds(date(2026, 12, 31))
    assert end == datetime(2027, 1, 1, 0, 0, tzinfo=IST)
