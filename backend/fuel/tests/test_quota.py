from dataclasses import FrozenInstanceError
from datetime import date, datetime
from decimal import Decimal

import pytest

from common.months import IST
from fuel.models import FuelRequest, RequestStatus
from fuel.quota import Quota, fmt, quota_for, quotas_for
from testing.factories import FuelGrantFactory, FuelRequestFactory, VehicleFactory, filled_request

pytestmark = pytest.mark.django_db

OCTOBER = date(2026, 10, 1)
SEPTEMBER = date(2026, 9, 1)


def ist(month, day, hour=12, minute=0):
    return datetime(2026, month, day, hour, minute, tzinfo=IST)


@pytest.fixture
def vehicle():
    return VehicleFactory(monthly_fuel_limit_litres=Decimal("100"))


def test_remaining_and_additional_balance_with_a_grant_and_two_fills(vehicle):
    FuelGrantFactory(vehicle=vehicle, month=OCTOBER, litres=Decimal("30"))
    filled_request(vehicle, Decimal("50"), ist(10, 3))
    filled_request(vehicle, Decimal("70"), ist(10, 9))

    quota = quota_for(vehicle, OCTOBER)

    assert quota.month == OCTOBER
    assert quota.base_litres == Decimal("100")
    assert quota.additional_litres == Decimal("30")
    assert quota.limit_litres == Decimal("130")
    assert quota.used_litres == Decimal("120")
    assert fmt(quota.remaining_litres) == "10.00"
    assert fmt(quota.additional_balance_litres) == "10.00"
    assert quota.emergency_used_litres == Decimal("0")
    assert quota.emergency_allowance_litres == Decimal("10")
    assert quota.emergency_remaining_litres == Decimal("10")


def test_an_emergency_fill_is_deducted_from_the_additional_quota_and_can_go_negative(vehicle):
    FuelGrantFactory(vehicle=vehicle, month=OCTOBER, litres=Decimal("30"))
    filled_request(vehicle, Decimal("50"), ist(10, 3))
    filled_request(vehicle, Decimal("70"), ist(10, 9))
    filled_request(vehicle, Decimal("15"), ist(10, 12), emergency_litres=Decimal("5"))

    quota = quota_for(vehicle, OCTOBER)

    assert quota.used_litres == Decimal("135")
    assert fmt(quota.remaining_litres) == "-5.00"
    assert fmt(quota.additional_balance_litres) == "-5.00"
    assert quota.emergency_used_litres == Decimal("5")
    assert fmt(quota.emergency_remaining_litres) == "5.00"


def test_a_fill_at_half_past_midnight_ist_on_the_first_counts_in_that_month_only(vehicle):
    # 2026-10-01 00:30 IST is still 2026-09-30 19:00 UTC: a UTC month would put it in September.
    filled_request(vehicle, Decimal("40"), ist(10, 1, hour=0, minute=30))

    assert quota_for(vehicle, OCTOBER).used_litres == Decimal("40")
    assert quota_for(vehicle, SEPTEMBER).used_litres == Decimal("0")


def test_month_edges_are_midnight_ist_start_inclusive_end_exclusive(vehicle):
    filled_request(vehicle, Decimal("11"), ist(9, 1, hour=0, minute=0))  # first instant of September
    filled_request(vehicle, Decimal("22"), ist(9, 30, hour=23, minute=59))  # last minute of September
    filled_request(vehicle, Decimal("33"), ist(10, 1, hour=0, minute=0))  # first instant of October

    assert quota_for(vehicle, SEPTEMBER).used_litres == Decimal("33")
    assert quota_for(vehicle, OCTOBER).used_litres == Decimal("33")
    assert FuelRequest.objects.count() == 3


@pytest.mark.parametrize(
    "status", [RequestStatus.ISSUED, RequestStatus.CANCELLED, RequestStatus.EXPIRED]
)
def test_only_filled_requests_are_counted(vehicle, status):
    FuelRequestFactory(
        vehicle=vehicle,
        status=status,
        litres_filled=Decimal("40"),
        emergency_litres=Decimal("5"),
        filled_at=ist(10, 5),
    )

    quota = quota_for(vehicle, OCTOBER)

    assert quota.used_litres == Decimal("0")
    assert quota.emergency_used_litres == Decimal("0")


def test_other_vehicles_and_other_months_do_not_count(vehicle):
    other = VehicleFactory(monthly_fuel_limit_litres=Decimal("100"))
    FuelGrantFactory(vehicle=vehicle, month=OCTOBER, litres=Decimal("30"))
    FuelGrantFactory(vehicle=vehicle, month=SEPTEMBER, litres=Decimal("99"))
    FuelGrantFactory(vehicle=other, month=OCTOBER, litres=Decimal("77"))
    filled_request(vehicle, Decimal("20"), ist(10, 5))
    filled_request(vehicle, Decimal("60"), ist(9, 20))
    filled_request(other, Decimal("55"), ist(10, 5), emergency_litres=Decimal("4"))

    quota = quota_for(vehicle, OCTOBER)

    assert quota.additional_litres == Decimal("30")
    assert quota.used_litres == Decimal("20")
    assert quota.emergency_used_litres == Decimal("0")


def test_several_grants_in_one_month_add_up(vehicle):
    FuelGrantFactory(vehicle=vehicle, month=OCTOBER, litres=Decimal("30"))
    FuelGrantFactory(vehicle=vehicle, month=OCTOBER, litres=Decimal("12.50"))

    assert quota_for(vehicle, OCTOBER).additional_litres == Decimal("42.50")


def test_a_month_with_no_activity_is_the_plain_limit(vehicle):
    quota = quota_for(vehicle, OCTOBER)

    assert (quota.additional_litres, quota.used_litres, quota.emergency_used_litres) == (0, 0, 0)
    assert quota.limit_litres == Decimal("100")
    assert quota.remaining_litres == Decimal("100")
    assert quota.additional_balance_litres == Decimal("0")
    assert quota.emergency_remaining_litres == Decimal("10")


def test_the_additional_balance_is_untouched_while_fills_stay_within_the_base_limit(vehicle):
    FuelGrantFactory(vehicle=vehicle, month=OCTOBER, litres=Decimal("30"))
    filled_request(vehicle, Decimal("90"), ist(10, 5))

    quota = quota_for(vehicle, OCTOBER)

    assert quota.additional_balance_litres == Decimal("30")
    assert quota.remaining_litres == Decimal("40")


def test_the_emergency_allowance_left_never_goes_below_zero(vehicle):
    filled_request(vehicle, Decimal("110"), ist(10, 5), emergency_litres=Decimal("10"))
    filled_request(vehicle, Decimal("5"), ist(10, 6), emergency_litres=Decimal("5"))

    assert quota_for(vehicle, OCTOBER).emergency_remaining_litres == Decimal("0")


def test_the_base_is_the_vehicles_current_monthly_limit(vehicle):
    vehicle.monthly_fuel_limit_litres = Decimal("80")
    vehicle.save()

    assert quota_for(vehicle, OCTOBER).base_litres == Decimal("80")


def test_a_day_in_the_middle_of_the_month_means_that_month(vehicle):
    FuelGrantFactory(vehicle=vehicle, month=OCTOBER, litres=Decimal("30"))
    filled_request(vehicle, Decimal("25"), ist(10, 5))

    quota = quota_for(vehicle, date(2026, 10, 17))

    assert quota.month == OCTOBER
    assert (quota.additional_litres, quota.used_litres) == (Decimal("30"), Decimal("25"))


def test_a_quota_is_a_frozen_value(vehicle):
    quota = quota_for(vehicle, OCTOBER)

    with pytest.raises(FrozenInstanceError):
        quota.used_litres = Decimal("1")
    assert isinstance(quota, Quota)


def test_quota_for_uses_two_queries(vehicle, django_assert_num_queries):
    with django_assert_num_queries(2):
        quota_for(vehicle, OCTOBER)


@pytest.mark.parametrize(
    "value, text",
    [
        (Decimal("5"), "5.00"),
        (Decimal("5.5"), "5.50"),
        (Decimal("0"), "0.00"),
        (Decimal("-5"), "-5.00"),
        (Decimal("1234.5"), "1234.50"),
        (Decimal("10.00"), "10.00"),
    ],
)
def test_fmt_gives_two_decimals(value, text):
    assert fmt(value) == text


def test_quotas_for_gives_each_vehicle_the_same_quota_as_quota_for(vehicle):
    busy = vehicle
    other = VehicleFactory(monthly_fuel_limit_litres=Decimal("60"))
    idle = VehicleFactory(monthly_fuel_limit_litres=Decimal("40"))
    FuelGrantFactory(vehicle=busy, month=OCTOBER, litres=Decimal("30"))
    FuelGrantFactory(vehicle=busy, month=OCTOBER, litres=Decimal("5"))
    FuelGrantFactory(vehicle=other, month=SEPTEMBER, litres=Decimal("99"))  # another month
    filled_request(busy, Decimal("50"), ist(10, 3))
    filled_request(busy, Decimal("15"), ist(10, 12), emergency_litres=Decimal("5"))
    filled_request(other, Decimal("10"), datetime(2026, 9, 30, 23, 59, tzinfo=IST))  # the month before
    filled_request(other, Decimal("7"), datetime(2026, 10, 1, 0, 0, tzinfo=IST))  # the first instant of the month
    filled_request(other, Decimal("8"), datetime(2026, 11, 1, 0, 0, tzinfo=IST))  # the month after

    quotas = quotas_for([busy, other, idle], OCTOBER)

    assert set(quotas) == {busy.pk, other.pk, idle.pk}
    for each in (busy, other, idle):
        assert quotas[each.pk] == quota_for(each, OCTOBER)
    assert quotas[busy.pk].limit_litres == Decimal("135")
    assert quotas[busy.pk].used_litres == Decimal("65")
    assert quotas[busy.pk].emergency_used_litres == Decimal("5")
    assert quotas[other.pk].additional_litres == Decimal("0")
    assert quotas[other.pk].used_litres == Decimal("7")
    assert quotas[idle.pk].used_litres == Decimal("0")


def test_quotas_for_a_month_day_reads_the_whole_month(vehicle):
    filled_request(vehicle, Decimal("12"), ist(10, 3))

    assert quotas_for([vehicle], date(2026, 10, 20))[vehicle.pk].used_litres == Decimal("12")


def test_quotas_for_no_vehicles_is_empty_and_asks_nothing(django_assert_num_queries):
    with django_assert_num_queries(0):
        assert quotas_for([], OCTOBER) == {}


def test_quotas_for_asks_two_questions_however_many_vehicles(django_assert_num_queries):
    vehicles = [VehicleFactory(monthly_fuel_limit_litres=Decimal("10")) for _ in range(4)]

    with django_assert_num_queries(2):
        quotas_for(vehicles, OCTOBER)
