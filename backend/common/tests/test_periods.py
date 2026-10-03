from datetime import date, datetime, timedelta
from unittest import mock

import pytest

from common.exceptions import BusinessRuleError
from common.months import IST
from common.periods import MAX_PERIOD_DAYS, Period, make_period, month_period, parse_period


def test_from_and_to_make_an_inclusive_period():
    assert parse_period({"from": "2026-09-28", "to": "2026-10-04"}) == Period(date(2026, 9, 28), date(2026, 10, 4))


def test_a_single_day_is_a_period():
    assert parse_period({"from": "2026-10-03", "to": "2026-10-03"}) == Period(date(2026, 10, 3), date(2026, 10, 3))


def test_surrounding_spaces_are_ignored():
    assert parse_period({"from": " 2026-10-01 ", "to": "2026-10-31 "}) == month_period(date(2026, 10, 1))


def test_no_dates_mean_the_current_month():
    with mock.patch("common.periods.today_ist", return_value=date(2026, 2, 14)):
        assert parse_period({}) == Period(date(2026, 2, 1), date(2026, 2, 28))


def test_no_dates_can_mean_another_default():
    fallback = Period(date(2026, 1, 1), date(2026, 1, 1))

    assert parse_period({"from": "", "to": "  "}, default=fallback) == fallback


@pytest.mark.parametrize("params", [{"from": "2026-10-01"}, {"to": "2026-10-01"}, {"from": "", "to": "2026-10-01"}])
def test_both_dates_are_needed(params):
    with pytest.raises(BusinessRuleError, match="^Give both the first and the last day of the period.$"):
        parse_period(params)


@pytest.mark.parametrize(
    "value", ["2026-1-05", "05-10-2026", "2026/10/05", "yesterday", "2026-02-30", "2026-13-01", "1999-12-31", "2101-01-01"]
)
def test_a_badly_written_date_is_refused(value):
    with pytest.raises(BusinessRuleError, match="^Use dates in the format YYYY-MM-DD.$"):
        parse_period({"from": value, "to": "2026-10-05"})


def test_the_first_day_cannot_come_after_the_last():
    with pytest.raises(BusinessRuleError, match="^The first day must be on or before the last day.$"):
        parse_period({"from": "2026-10-05", "to": "2026-10-04"})


def test_a_period_is_at_most_a_year_long():
    longest = parse_period({"from": "2027-04-01", "to": "2028-03-31"})  # a financial year with 29 February
    assert longest.days == MAX_PERIOD_DAYS == 366

    with pytest.raises(BusinessRuleError, match="^Pick a period of at most a year.$"):
        parse_period({"from": "2026-04-01", "to": "2027-04-02"})


def test_bounds_are_the_period_in_asia_kolkata_with_the_last_day_included():
    start, end = Period(date(2026, 9, 28), date(2026, 10, 4)).bounds()

    assert start == datetime(2026, 9, 28, tzinfo=IST)
    assert end == datetime(2026, 10, 5, tzinfo=IST)
    assert end - start == timedelta(days=7)


def test_month_period_runs_from_the_first_to_the_last_day():
    assert month_period(date(2026, 2, 1)) == Period(date(2026, 2, 1), date(2026, 2, 28))
    assert month_period(date(2028, 2, 1)) == Period(date(2028, 2, 1), date(2028, 2, 29))
    assert month_period(date(2026, 12, 1)) == Period(date(2026, 12, 1), date(2026, 12, 31))


@pytest.mark.parametrize(
    ("period", "label"),
    [
        (Period(date(2026, 10, 3), date(2026, 10, 3)), "03 Oct 2026"),
        (Period(date(2026, 10, 1), date(2026, 10, 31)), "October 2026"),
        (Period(date(2026, 4, 1), date(2027, 3, 31)), "FY 2026-27"),
        (Period(date(2026, 9, 28), date(2026, 10, 4)), "28 Sep – 04 Oct 2026"),
        (Period(date(2025, 12, 29), date(2026, 1, 4)), "29 Dec 2025 – 04 Jan 2026"),
        (Period(date(2026, 1, 1), date(2026, 12, 31)), "01 Jan – 31 Dec 2026"),
    ],
)
def test_label(period, label):
    assert period.label == label


def test_make_period_checks_the_order_and_length_of_two_dates():
    assert make_period(date(2026, 10, 1), date(2026, 10, 7)) == Period(date(2026, 10, 1), date(2026, 10, 7))
    with pytest.raises(BusinessRuleError, match="^The first day must be on or before the last day.$"):
        make_period(date(2026, 10, 7), date(2026, 10, 1))
    with pytest.raises(BusinessRuleError, match="^Pick a period of at most a year.$"):
        make_period(date(2026, 1, 1), date(2027, 1, 2))


@pytest.mark.parametrize("day", [date(1999, 12, 31), date(2101, 1, 1)])
def test_make_period_keeps_to_this_century(day):
    with pytest.raises(BusinessRuleError, match="^Pick dates from 2000 to 2100.$"):
        make_period(day, day)
