from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from accounts.models import UserStatus
from common.exceptions import BusinessRuleError
from fleet import services
from fleet.models import VehicleStatus
from fuel import requests
from fuel.models import EmergencyStatus, RequestStatus
from pumps.models import PumpKind
from testing.factories import (
    DriverFactory,
    FuelGrantFactory,
    FuelRequestFactory,
    MTOFactory,
    PumpFactory,
    UnitFactory,
    VehicleFactory,
    filled_request,
    police_pump,
    tieup_pump,
)

pytestmark = pytest.mark.django_db

NOT_LINKED = "You are not linked to a vehicle. Contact your MTO."
NOT_ACTIVE = "This vehicle is paused or terminated."
ALREADY_OPEN = "This vehicle already has an open request. Use its PIN or cancel it first."
ONLY_OPEN = "Only an open request can be cancelled."
NEW_DRIVER = "The vehicle has a new driver."


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def vehicle(mto):
    return VehicleFactory(
        unit=mto.unit, tank_capacity_litres=Decimal("60"), monthly_fuel_limit_litres=Decimal("100")
    )


@pytest.fixture
def driver(mto, vehicle):
    person = DriverFactory(unit=mto.unit)
    services.assign_person(vehicle, person, mto)
    return person


def ask(driver, litres, **extra):
    """Ask at a tie-up bunk of the driver's office that sells both fuels, unless `pump` is given."""
    extra.setdefault("pump", tieup_pump(driver.unit))
    return requests.create_request(driver=driver, litres=Decimal(litres), **extra)


def refusal(driver, litres, **extra) -> str:
    with pytest.raises(BusinessRuleError) as error:
        ask(driver, litres, **extra)
    return str(error.value.detail)


def assert_valid_for_24_hours(issued_at, expires_at):
    # issued_at is stamped when the row is saved, a moment after expires_at was worked out.
    assert abs(expires_at - issued_at - timedelta(hours=24)) < timedelta(seconds=5)


def fill_this_month(vehicle, litres, emergency_litres="0"):
    return filled_request(vehicle, Decimal(litres), timezone.now(), emergency_litres=Decimal(emergency_litres))


# --- PIN ---------------------------------------------------------------------------------------


def test_a_pin_is_six_digits():
    for _ in range(200):
        pin = requests.new_pin()
        assert len(pin) == 6
        assert pin.isdigit()


def test_a_small_pin_is_padded_with_zeros(monkeypatch):
    asked = []
    monkeypatch.setattr(requests, "randbelow", lambda bound: asked.append(bound) or 42)

    assert requests.new_pin() == "000042"
    assert asked == [1_000_000]


# --- expiry ------------------------------------------------------------------------------------


def test_expire_stale_marks_only_open_requests_that_have_run_out(vehicle):
    now = timezone.now()
    stale = FuelRequestFactory(vehicle=vehicle, expires_at=now - timedelta(minutes=1))
    on_the_dot = FuelRequestFactory(vehicle=VehicleFactory(), expires_at=now)
    fresh = FuelRequestFactory(vehicle=VehicleFactory(), expires_at=now + timedelta(minutes=1))
    filled = filled_request(VehicleFactory(), Decimal("5"), now - timedelta(days=2))
    filled.expires_at = now - timedelta(days=1)
    filled.save(update_fields=["expires_at"])
    cancelled = FuelRequestFactory(
        vehicle=VehicleFactory(), status=RequestStatus.CANCELLED, expires_at=now - timedelta(days=1)
    )

    assert requests.expire_stale(now=now) == 2

    for item in (stale, on_the_dot, fresh, filled, cancelled):
        item.refresh_from_db()
    assert stale.status == RequestStatus.EXPIRED
    assert on_the_dot.status == RequestStatus.EXPIRED
    assert fresh.status == RequestStatus.ISSUED
    assert filled.status == RequestStatus.FILLED
    assert cancelled.status == RequestStatus.CANCELLED


def test_expire_stale_can_be_limited_to_one_vehicle(vehicle):
    now = timezone.now()
    mine = FuelRequestFactory(vehicle=vehicle, expires_at=now - timedelta(hours=1))
    other = FuelRequestFactory(vehicle=VehicleFactory(), expires_at=now - timedelta(hours=1))

    assert requests.expire_stale(vehicle, now=now) == 1

    mine.refresh_from_db()
    other.refresh_from_db()
    assert mine.status == RequestStatus.EXPIRED
    assert other.status == RequestStatus.ISSUED


def test_expire_stale_uses_the_current_time_by_default(vehicle):
    stale = FuelRequestFactory(vehicle=vehicle, expires_at=timezone.now() - timedelta(seconds=5))

    assert requests.expire_stale() == 1

    stale.refresh_from_db()
    assert stale.status == RequestStatus.EXPIRED
    assert requests.expire_stale() == 0


# --- raising a request -------------------------------------------------------------------------


# --- the pump the driver will fill at -------------------------------------------------------------


def test_the_request_is_for_the_pump_the_driver_picked_which_may_be_of_any_office(driver):
    elsewhere = tieup_pump(UnitFactory())

    assert ask(driver, "20", pump=elsewhere).pump == elsewhere


def test_a_closed_pump_is_refused(driver):
    closed = PumpFactory(unit=driver.unit, name="Old Road Pump", is_active=False)

    assert refusal(driver, "20", pump=closed) == "Old Road Pump is closed. Pick another pump."


def test_a_pump_that_does_not_sell_the_vehicles_fuel_is_refused(vehicle, driver):
    petrol_only = PumpFactory(
        unit=driver.unit, name="Krishna Fuel Point", kind=PumpKind.TIE_UP, sells_diesel=False
    )

    assert vehicle.fuel_type == "DIESEL"
    assert refusal(driver, "20", pump=petrol_only) == "Krishna Fuel Point does not sell diesel. Pick another pump."


def test_a_police_pump_without_the_fuel_in_stock_is_refused(driver):
    empty = police_pump(driver.unit, petrol=Decimal("500"), diesel=Decimal("0"))
    empty.name = "Nellore DPO Police Pump"
    empty.save()

    assert refusal(driver, "20", pump=empty) == "Nellore DPO Police Pump has no diesel in stock. Pick another pump."


def test_a_police_pump_holding_less_than_asked_for_is_refused_with_what_it_holds(driver):
    low = police_pump(driver.unit, diesel=Decimal("12.5"))
    low.name = "Kavali Police Pump"
    low.save()

    assert refusal(driver, "20", pump=low) == (
        "Kavali Police Pump has only 12.50 L of diesel. Ask for less or pick another pump."
    )
    assert ask(driver, "12.5", pump=low).litres_requested == Decimal("12.5")


def test_a_tie_up_bunk_keeps_no_stock_so_its_stock_is_never_checked(driver):
    assert ask(driver, "40", pump=tieup_pump(driver.unit)).litres_requested == Decimal("40")


def test_a_request_within_the_limit_gets_a_pin_for_24_hours(vehicle, driver):
    created = ask(driver, "20.50")

    created.refresh_from_db()
    assert created.vehicle == vehicle
    assert created.driver == driver
    assert created.fuel_type == vehicle.fuel_type
    assert created.litres_requested == Decimal("20.50")
    assert created.status == RequestStatus.ISSUED
    assert created.is_emergency is False
    assert created.emergency_reason == ""
    assert created.emergency_status == EmergencyStatus.NONE
    assert len(created.pin) == 6 and created.pin.isdigit()
    assert_valid_for_24_hours(created.issued_at, created.expires_at)


def test_the_request_takes_its_fuel_type_from_the_vehicle(mto):
    petrol_vehicle = VehicleFactory(unit=mto.unit, fuel_type="PETROL", tank_capacity_litres=Decimal("30"))
    person = DriverFactory(unit=mto.unit)
    services.assign_person(petrol_vehicle, person, mto)

    assert ask(person, "10").fuel_type == "PETROL"


def test_the_whole_tank_may_be_asked_for(driver):
    assert ask(driver, "60").litres_requested == Decimal("60")


def test_an_unlinked_driver_is_refused(vehicle):
    assert refusal(DriverFactory(unit=vehicle.unit), "10") == NOT_LINKED


def test_a_driver_whose_link_has_ended_is_refused(mto, vehicle, driver):
    services.end_assignment(driver.vehicle_assignments.get(ended_at__isnull=True), mto)

    assert refusal(driver, "10") == NOT_LINKED


@pytest.mark.parametrize("status", [VehicleStatus.PAUSED, VehicleStatus.TERMINATION_PENDING])
def test_a_vehicle_that_is_not_active_is_refused(vehicle, driver, status):
    vehicle.status = status
    vehicle.save()

    assert refusal(driver, "10") == NOT_ACTIVE


def test_more_than_the_tank_holds_is_refused(driver):
    assert refusal(driver, "60.01") == "The tank holds only 60.00 L."


def test_a_second_request_while_one_is_open_is_refused(driver):
    ask(driver, "10")

    assert refusal(driver, "10") == ALREADY_OPEN


def test_an_open_request_that_ran_out_is_expired_and_a_new_one_is_allowed(vehicle, driver):
    stale = FuelRequestFactory(
        vehicle=vehicle, driver=driver, expires_at=timezone.now() - timedelta(minutes=1)
    )

    created = ask(driver, "10")

    stale.refresh_from_db()
    assert stale.status == RequestStatus.EXPIRED
    assert created.status == RequestStatus.ISSUED
    assert created.pk != stale.pk


def test_a_new_request_is_allowed_after_the_last_one_was_cancelled(driver):
    first = ask(driver, "10")
    requests.cancel_request(first, driver)

    second = ask(driver, "10")

    assert second.status == RequestStatus.ISSUED
    assert second.pk != first.pk


def test_a_new_request_is_allowed_after_the_last_one_was_filled(vehicle, driver):
    filled_request(vehicle, Decimal("10"), timezone.now(), driver=driver)

    assert ask(driver, "10").status == RequestStatus.ISSUED


def relinked_to_a_new_driver(mto, vehicle, old_driver):
    """The old driver's link ends and a new driver of the same office is linked in their place."""
    services.end_assignment(old_driver.vehicle_assignments.get(ended_at__isnull=True), mto)
    new_driver = DriverFactory(unit=mto.unit)
    services.assign_person(vehicle, new_driver, mto)
    return new_driver


def test_a_new_driver_can_request_after_a_relink_and_the_old_drivers_open_request_is_cancelled(mto, vehicle, driver):
    old = ask(driver, "10")
    new_driver = relinked_to_a_new_driver(mto, vehicle, driver)

    created = ask(new_driver, "10")

    old.refresh_from_db()
    assert old.status == RequestStatus.CANCELLED
    assert old.cancel_reason == NEW_DRIVER
    assert created.status == RequestStatus.ISSUED
    assert created.driver == new_driver


def test_a_new_driver_can_request_after_the_old_driver_was_terminated(mto, vehicle, driver):
    old = ask(driver, "10")
    driver.status = UserStatus.TERMINATED
    driver.save()
    services.end_all_for_person(driver, mto)
    new_driver = DriverFactory(unit=mto.unit)
    services.assign_person(vehicle, new_driver, mto)

    created = ask(new_driver, "10")

    old.refresh_from_db()
    assert (old.status, old.cancel_reason) == (RequestStatus.CANCELLED, NEW_DRIVER)
    assert created.status == RequestStatus.ISSUED


def test_a_new_driver_asking_leaves_the_old_drivers_filled_request_alone(mto, vehicle, driver):
    filled = fill_this_month(vehicle, "10")
    new_driver = relinked_to_a_new_driver(mto, vehicle, driver)

    ask(new_driver, "10")

    filled.refresh_from_db()
    assert filled.status == RequestStatus.FILLED
    assert filled.cancel_reason == ""


def test_the_drivers_own_open_request_is_not_cancelled_by_the_new_driver_rule(driver):
    first = ask(driver, "10")

    assert refusal(driver, "10") == ALREADY_OPEN
    first.refresh_from_db()
    assert first.status == RequestStatus.ISSUED


def test_a_request_the_new_driver_is_refused_for_leaves_the_old_open_request_open(mto, vehicle, driver):
    old = ask(driver, "10")
    new_driver = relinked_to_a_new_driver(mto, vehicle, driver)

    assert refusal(new_driver, "61") == "The tank holds only 60.00 L."

    old.refresh_from_db()
    assert old.status == RequestStatus.ISSUED


def test_checks_run_in_order_not_linked_then_paused_then_tank_then_open_request(mto, vehicle, driver):
    ask(driver, "10")
    assert refusal(driver, "61") == "The tank holds only 60.00 L."  # the tank before the open request

    vehicle.status = VehicleStatus.PAUSED
    vehicle.save()
    assert refusal(driver, "61") == NOT_ACTIVE  # paused before the tank

    assert refusal(DriverFactory(unit=mto.unit), "61") == NOT_LINKED  # not linked before everything


# --- the monthly limit and emergencies ---------------------------------------------------------


def test_asking_for_all_that_is_left_is_not_an_emergency(vehicle, driver):
    fill_this_month(vehicle, "60")
    fill_this_month(vehicle, "30")  # 10 L left

    created = ask(driver, "10")

    assert created.is_emergency is False


def test_more_than_is_left_without_an_emergency_is_refused_with_the_numbers(vehicle, driver):
    fill_this_month(vehicle, "60")
    fill_this_month(vehicle, "30")  # 10 L left, 10 L of emergency allowance

    message = refusal(driver, "15")

    assert message == (
        "Only 10.00 L is left this month. Mark it as an emergency and give the reason to draw up to 20.00 L."
    )


def test_an_emergency_without_a_reason_is_refused(vehicle, driver):
    fill_this_month(vehicle, "60")
    fill_this_month(vehicle, "30")
    expected = (
        "Only 10.00 L is left this month. Mark it as an emergency and give the reason to draw up to 20.00 L."
    )

    assert refusal(driver, "15", is_emergency=True) == expected
    assert refusal(driver, "15", is_emergency=True, reason="   ") == expected
    assert refusal(driver, "15", reason="Flood duty") == expected  # a reason alone does not make an emergency


def test_an_emergency_with_a_reason_is_allowed(vehicle, driver):
    fill_this_month(vehicle, "60")
    fill_this_month(vehicle, "30")

    created = ask(driver, "15", is_emergency=True, reason="  Flood duty at Kavali  ")

    created.refresh_from_db()
    assert created.is_emergency is True
    assert created.emergency_reason == "Flood duty at Kavali"
    assert created.litres_requested == Decimal("15")
    assert created.emergency_status == EmergencyStatus.NONE  # the MTO is alerted when the fuel is actually filled


def test_an_emergency_may_use_up_to_the_remaining_plus_ten_litres(vehicle, driver):
    fill_this_month(vehicle, "60")
    fill_this_month(vehicle, "30")  # 10 L left

    assert ask(driver, "20", is_emergency=True, reason="Chase").is_emergency is True


def test_an_emergency_over_what_is_left_plus_ten_litres_is_refused(vehicle, driver):
    fill_this_month(vehicle, "60")
    fill_this_month(vehicle, "30")  # 10 L left

    message = refusal(driver, "20.01", is_emergency=True, reason="Chase")

    assert message == "This vehicle can draw at most 20.00 L more this month."


def test_over_the_most_that_can_be_drawn_the_at_most_message_comes_first(vehicle, driver):
    fill_this_month(vehicle, "60")
    fill_this_month(vehicle, "30")

    assert refusal(driver, "25") == "This vehicle can draw at most 20.00 L more this month."


def test_the_reason_is_dropped_when_the_request_is_within_the_limit(driver):
    created = ask(driver, "10", is_emergency=True, reason="Just in case")

    assert created.is_emergency is False
    assert created.emergency_reason == ""


def test_a_second_emergency_can_only_use_what_is_left_of_the_ten_litres(vehicle, driver):
    fill_this_month(vehicle, "60")
    fill_this_month(vehicle, "46", emergency_litres="6")  # limit 100 used up, 6 of 10 emergency litres drawn

    assert refusal(driver, "4.01", is_emergency=True, reason="Chase") == (
        "This vehicle can draw at most 4.00 L more this month."
    )
    created = ask(driver, "4", is_emergency=True, reason="Chase")
    assert created.is_emergency is True


def test_when_the_emergency_litres_are_used_up_nothing_more_can_be_drawn(vehicle, driver):
    fill_this_month(vehicle, "60")
    fill_this_month(vehicle, "50", emergency_litres="10")

    assert refusal(driver, "1", is_emergency=True, reason="Chase") == (
        "This vehicle can draw at most 0.00 L more this month."
    )


def test_additional_quota_raises_what_can_be_asked_for_without_an_emergency(vehicle, driver):
    fill_this_month(vehicle, "60")
    fill_this_month(vehicle, "40")  # limit 100 used up
    FuelGrantFactory(vehicle=vehicle, litres=Decimal("30"))

    assert ask(driver, "30").is_emergency is False


def test_fuel_filled_in_an_earlier_month_does_not_count(vehicle, driver):
    filled_request(vehicle, Decimal("60"), timezone.now() - timedelta(days=45))
    filled_request(vehicle, Decimal("60"), timezone.now() - timedelta(days=75))

    assert ask(driver, "60").is_emergency is False


def test_a_request_that_failed_a_rule_creates_nothing(vehicle, driver):
    refusal(driver, "61")

    assert vehicle.fuel_requests.count() == 0


# --- cancelling --------------------------------------------------------------------------------


def test_cancelling_an_open_request(driver):
    created = ask(driver, "10")

    cancelled = requests.cancel_request(created, driver)

    assert cancelled.status == RequestStatus.CANCELLED
    assert cancelled.cancel_reason == "Cancelled by the driver."
    created.refresh_from_db()
    assert created.status == RequestStatus.CANCELLED
    assert created.cancel_reason == "Cancelled by the driver."


def test_a_filled_request_cannot_be_cancelled(vehicle, driver):
    filled = filled_request(vehicle, Decimal("10"), timezone.now(), driver=driver)

    with pytest.raises(BusinessRuleError) as error:
        requests.cancel_request(filled, driver)

    assert str(error.value.detail) == ONLY_OPEN
    filled.refresh_from_db()
    assert filled.status == RequestStatus.FILLED


@pytest.mark.parametrize("status", [RequestStatus.CANCELLED, RequestStatus.EXPIRED])
def test_a_cancelled_or_expired_request_cannot_be_cancelled(driver, status):
    created = ask(driver, "10")
    created.status = status
    created.save()

    with pytest.raises(BusinessRuleError) as error:
        requests.cancel_request(created, driver)

    assert str(error.value.detail) == ONLY_OPEN


def test_a_request_that_ran_out_cannot_be_cancelled(vehicle, driver):
    stale = FuelRequestFactory(vehicle=vehicle, driver=driver, expires_at=timezone.now() - timedelta(minutes=1))

    with pytest.raises(BusinessRuleError) as error:
        requests.cancel_request(stale, driver)

    assert str(error.value.detail) == ONLY_OPEN
    stale.refresh_from_db()
    assert stale.status == RequestStatus.EXPIRED


def test_cancel_works_on_the_current_state_not_a_stale_copy(driver):
    created = ask(driver, "10")
    stale_copy = type(created).objects.get(pk=created.pk)
    requests.cancel_request(created, driver)

    with pytest.raises(BusinessRuleError) as error:
        requests.cancel_request(stale_copy, driver)

    assert str(error.value.detail) == ONLY_OPEN


def test_only_the_driver_who_raised_a_request_can_cancel_it(mto, driver):
    created = ask(driver, "10")

    with pytest.raises(BusinessRuleError) as error:
        requests.cancel_request(created, DriverFactory(unit=mto.unit))

    assert str(error.value.detail) == "Only the driver who raised a request can cancel it."
    created.refresh_from_db()
    assert created.status == RequestStatus.ISSUED
