from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from common.months import IST, current_month
from fleet import services
from fleet.models import AssignmentKind, FuelType, VehicleAssignment
from fuel.models import FuelRequest, RequestStatus
from notifications.models import Notification
from testing.factories import (
    DriverFactory,
    FuelRequestFactory,
    MTOFactory,
    OfficerFactory,
    PTOFactory,
    PumpStaffFactory,
    UnitFactory,
    VehicleFactory,
    filled_request,
    police_pump,
    tieup_pump,
    unit_mto,
)

pytestmark = pytest.mark.django_db

INCOMING = "/api/fuel/incoming/"
FILLS = "/api/fuel/pump-fills/"
PIN = "123456"
FIELDS = {
    "id", "vehicle", "registration_number", "driver", "driver_name", "fuel_type", "litres_requested",
    "is_emergency", "emergency_reason", "status", "status_label", "issued_at", "expires_at", "pin",
    "failed_pin_attempts", "cancel_reason", "pump", "pump_name", "pump_kind", "filled_at", "litres_filled",
    "emergency_litres", "emergency_status", "emergency_status_label", "duty_particulars", "duty_submitted_at",
    "duty_due_at", "duty_overdue",
}
INCOMING_FIELDS = {
    "id", "vehicle", "registration_number", "vehicle_name", "driver_name", "driver_mobile", "fuel_type",
    "is_emergency", "issued_at", "expires_at",
}


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def vehicle(mto):
    return VehicleFactory(
        unit=mto.unit,
        registration_number="AP39PA1234",
        make="Mahindra",
        model="Bolero",
        fuel_type=FuelType.DIESEL,
        tank_capacity_litres=Decimal("60"),
        monthly_fuel_limit_litres=Decimal("100"),
    )


@pytest.fixture
def driver(mto, vehicle):
    person = DriverFactory(unit=mto.unit, full_name="Ravi Kumar", mobile="9876543210")
    services.assign_person(vehicle, person, mto)
    return person


@pytest.fixture
def bunk():
    return tieup_pump(UnitFactory())


@pytest.fixture
def operator(bunk):
    return PumpStaffFactory(pump=bunk, unit=bunk.unit)


@pytest.fixture
def open_request(vehicle, driver, bunk):
    return FuelRequestFactory(vehicle=vehicle, driver=driver, pump=bunk, litres_requested=Decimal("20"), pin=PIN)


def check(api, request, pin=PIN):
    return api.post(f"{INCOMING}{request.pk}/check-pin/", {"pin": pin})


def fill(api, request, pin=PIN):
    return api.post(f"{INCOMING}{request.pk}/fill/", {"pin": pin})


def ids(response):
    return [row["id"] for row in response.json()]


# --- GET /api/fuel/incoming/ -------------------------------------------------------------------


def test_the_incoming_list_shows_who_is_coming_but_not_the_litres_or_pin(api, operator, open_request):
    api.force_login(operator)

    response = api.get(INCOMING)

    assert response.status_code == 200
    [row] = response.json()
    assert set(row) == INCOMING_FIELDS
    assert row["id"] == open_request.id
    assert row["registration_number"] == "AP39PA1234"
    assert row["vehicle_name"] == "Mahindra Bolero"
    assert row["driver_name"] == "Ravi Kumar"
    assert row["driver_mobile"] == "9876543210"
    assert row["fuel_type"] == "DIESEL"
    assert row["is_emergency"] is False


def test_the_incoming_list_holds_only_this_pumps_open_requests(api, operator, open_request, vehicle):
    other_pump = tieup_pump(UnitFactory())
    FuelRequestFactory(vehicle=VehicleFactory(unit=vehicle.unit), pump=other_pump)
    api.force_login(operator)

    assert ids(api.get(INCOMING)) == [open_request.id]


@pytest.mark.parametrize(
    "make_user", [MTOFactory, PTOFactory, OfficerFactory, DriverFactory], ids=["mto", "pto", "officer", "driver"]
)
def test_only_pump_staff_see_an_incoming_list(api, make_user):
    api.force_login(make_user())

    assert api.get(INCOMING).status_code == 403


# --- POST /api/fuel/incoming/<id>/check-pin/ ---------------------------------------------------


def test_the_right_pin_reveals_the_litres_to_fill(api, operator, open_request):
    api.force_login(operator)

    response = check(api, open_request)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == INCOMING_FIELDS | {"litres_requested", "emergency_reason"}
    assert body["litres_requested"] == "20.00"
    open_request.refresh_from_db()
    assert open_request.status == RequestStatus.ISSUED


def test_a_wrong_pin_at_the_check_is_a_400_and_counts(api, operator, open_request):
    api.force_login(operator)

    response = check(api, open_request, pin="000000")

    assert response.status_code == 400
    assert response.json() == {"detail": "Wrong PIN. 4 attempt(s) left."}
    open_request.refresh_from_db()
    assert open_request.failed_pin_attempts == 1


# --- POST /api/fuel/incoming/<id>/fill/ --------------------------------------------------------


def test_the_operator_fills_exactly_the_request_and_gets_it_back_without_the_pin(api, operator, bunk, open_request):
    api.force_login(operator)

    response = fill(api, open_request)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == FIELDS
    assert body["id"] == open_request.id
    assert body["status"] == "FILLED"
    assert body["status_label"] == "Filled"
    assert body["pin"] is None
    assert body["registration_number"] == "AP39PA1234"
    assert body["pump"] == bunk.id
    assert body["pump_name"] == bunk.name
    assert body["pump_kind"] == "TIE_UP"
    assert body["litres_requested"] == "20.00"
    assert body["litres_filled"] == "20.00"
    assert body["filled_at"] is not None
    assert body["emergency_litres"] == "0.00"
    assert body["emergency_status"] == "NONE"
    assert body["duty_due_at"] is not None
    assert body["duty_overdue"] is False
    assert FuelRequest.objects.get(pk=body["id"]).status == RequestStatus.FILLED


def test_a_police_pump_fill_reduces_the_stock(api, vehicle, driver):
    pump = police_pump(UnitFactory(), diesel=Decimal("300"))
    request = FuelRequestFactory(vehicle=vehicle, driver=driver, pump=pump, litres_requested=Decimal("20"), pin=PIN)
    api.force_login(PumpStaffFactory(pump=pump, unit=pump.unit))

    response = fill(api, request)

    assert response.status_code == 200
    assert response.json()["pump_kind"] == "POLICE"
    assert pump.tanks.get(fuel_type=FuelType.DIESEL).current_stock_litres == Decimal("280")


def test_insufficient_police_stock_is_a_400_and_the_request_stays_open(api, vehicle, driver):
    pump = police_pump(UnitFactory(), diesel=Decimal("5"))
    request = FuelRequestFactory(vehicle=vehicle, driver=driver, pump=pump, litres_requested=Decimal("20"), pin=PIN)
    api.force_login(PumpStaffFactory(pump=pump, unit=pump.unit))

    response = fill(api, request)

    assert response.status_code == 400
    assert response.json() == {
        "detail": "Only 5.00 L of diesel in stock."
    }
    request.refresh_from_db()
    assert request.status == RequestStatus.ISSUED


def test_the_fifth_wrong_pin_cancels_the_request_and_it_stays_cancelled(api, operator, open_request):
    api.force_login(operator)
    for _ in range(4):
        fill(api, open_request, pin="000000")

    response = fill(api, open_request, pin="000000")

    assert response.json() == {
        "detail": "Too many wrong PINs. This request is cancelled; the driver must raise a new one."
    }
    open_request.refresh_from_db()
    assert open_request.status == RequestStatus.CANCELLED
    assert fill(api, open_request).json() == {"detail": "This request is no longer open."}


def test_an_expired_pin_is_marked_expired_and_refused(api, operator, open_request):
    open_request.expires_at = timezone.now() - timedelta(minutes=1)
    open_request.save()
    api.force_login(operator)

    response = fill(api, open_request)

    assert response.status_code == 400
    assert response.json() == {"detail": "This PIN has expired. The driver must raise a new request."}
    open_request.refresh_from_db()
    assert open_request.status == RequestStatus.EXPIRED


def test_filling_twice_refuses_the_second_time(api, operator, open_request):
    api.force_login(operator)
    fill(api, open_request)

    response = fill(api, open_request)

    assert response.status_code == 400
    assert response.json() == {"detail": "This request is no longer open."}


def test_an_emergency_fill_alerts_the_mto(api, operator, bunk, vehicle, driver, mto):
    filled_request(vehicle, Decimal("95"), timezone.now())
    request = FuelRequestFactory(
        vehicle=vehicle, driver=driver, pump=bunk, litres_requested=Decimal("12"), is_emergency=True,
        emergency_reason="VIP bandobast", pin=PIN,
    )
    api.force_login(operator)

    body = fill(api, request).json()

    assert body["emergency_litres"] == "7.00"
    assert body["emergency_status"] == "PENDING"
    assert Notification.objects.filter(recipient=mto, title="Emergency fill: AP39PA1234").exists()


@pytest.mark.parametrize("step", [check, fill])
def test_a_request_of_another_pump_is_a_404_and_costs_no_attempt(api, open_request, step):
    other = tieup_pump(UnitFactory())
    api.force_login(PumpStaffFactory(pump=other, unit=other.unit))

    assert step(api, open_request).status_code == 404
    open_request.refresh_from_db()
    assert open_request.failed_pin_attempts == 0


@pytest.mark.parametrize("pin", [None, "1234567"])
@pytest.mark.parametrize("step", [check, fill])
def test_a_missing_or_too_long_pin_is_a_field_error_and_costs_no_attempt(api, operator, open_request, step, pin):
    api.force_login(operator)
    url = f"{INCOMING}{open_request.pk}/{'check-pin' if step is check else 'fill'}/"

    response = api.post(url, {} if pin is None else {"pin": pin})

    assert response.status_code == 400
    assert "pin" in response.json()
    open_request.refresh_from_db()
    assert open_request.failed_pin_attempts == 0


@pytest.mark.parametrize(
    "make_user", [MTOFactory, PTOFactory, OfficerFactory, DriverFactory], ids=["mto", "pto", "officer", "driver"]
)
@pytest.mark.parametrize("step", [check, fill])
def test_only_pump_staff_can_check_or_fill(api, open_request, make_user, step):
    api.force_login(make_user())

    assert step(api, open_request).status_code == 403
    open_request.refresh_from_db()
    assert open_request.status == RequestStatus.ISSUED


def test_an_anonymous_caller_cannot_fill(api, open_request):
    assert fill(api, open_request).status_code in (401, 403)


def test_an_operator_of_an_inactive_pump_cannot_fill(api, operator, bunk, open_request):
    bunk.is_active = False
    bunk.save()
    api.force_login(operator)

    response = fill(api, open_request)

    assert response.status_code == 400
    assert response.json() == {"detail": "Your pump is not active. Contact your MTO."}


def test_the_old_redeem_address_is_gone(api, operator):
    api.force_login(operator)

    assert api.post("/api/fuel/redeem/", {}).status_code == 404


# --- GET /api/fuel/pump-fills/ -----------------------------------------------------------------


def fill_at(vehicle, pump, filled_at, litres="10"):
    return filled_request(vehicle, Decimal(litres), filled_at, pump=pump)


def test_pump_fills_lists_this_months_fills_at_the_callers_pump_newest_first(api, operator, bunk, vehicle):
    now = timezone.now()
    older = fill_at(vehicle, bunk, now - timedelta(minutes=30))
    newest = fill_at(VehicleFactory(unit=vehicle.unit), bunk, now - timedelta(minutes=1))
    api.force_login(operator)

    response = api.get(FILLS)

    assert response.status_code == 200
    assert ids(response) == [newest.id, older.id]
    row = response.json()[0]
    # Only what the pump's table needs: not the driver's duty particulars, the emergency or the PIN.
    assert set(row) == {
        "id", "registration_number", "driver_name", "fuel_type", "litres_filled", "filled_at", "officer_name",
    }
    assert (row["registration_number"], row["litres_filled"]) == (newest.vehicle.registration_number, "10.00")


def test_each_pump_fill_names_the_officer_the_vehicle_was_linked_to_at_the_time(api, operator, bunk, vehicle):
    mto = unit_mto(vehicle.unit)
    now = timezone.now()
    first_officer = OfficerFactory(unit=vehicle.unit, full_name="S. Venkata Rao")
    second_officer = OfficerFactory(unit=vehicle.unit, full_name="K. Lakshmi")
    link = services.assign_person(vehicle, first_officer, mto)
    VehicleAssignment.objects.filter(pk=link.pk).update(started_at=now - timedelta(days=3))
    before = fill_at(vehicle, bunk, now - timedelta(days=2))
    VehicleAssignment.objects.filter(pk=link.pk).update(ended_at=now - timedelta(days=1))
    VehicleAssignment.objects.create(
        vehicle=vehicle, person=second_officer, kind=AssignmentKind.OFFICER, assigned_by=mto
    )
    VehicleAssignment.objects.filter(person=second_officer).update(started_at=now - timedelta(hours=20))
    after = fill_at(vehicle, bunk, now - timedelta(hours=1))
    unlinked = fill_at(VehicleFactory(unit=vehicle.unit), bunk, now - timedelta(minutes=5))
    api.force_login(operator)

    rows = {row["id"]: row["officer_name"] for row in api.get(FILLS).json()}

    assert rows == {before.id: "S. Venkata Rao", after.id: "K. Lakshmi", unlinked.id: None}


def test_pump_fills_leaves_out_other_pumps_other_months_and_unfilled_requests(api, operator, bunk, vehicle):
    now = timezone.now()
    mine = fill_at(vehicle, bunk, now)
    fill_at(vehicle, tieup_pump(bunk.unit), now)  # another pump of the same unit
    fill_at(vehicle, bunk, now - timedelta(days=45))  # an earlier month
    FuelRequestFactory(vehicle=VehicleFactory(unit=vehicle.unit))  # open
    FuelRequestFactory(vehicle=VehicleFactory(unit=vehicle.unit), status=RequestStatus.CANCELLED, pump=bunk)
    api.force_login(operator)

    assert ids(api.get(FILLS)) == [mine.id]


def test_pump_fills_for_an_earlier_period(api, operator, bunk, vehicle):
    fill_at(vehicle, bunk, timezone.now())
    start = current_month()
    earlier_day = datetime(start.year, start.month, 1, 12, tzinfo=IST) - timedelta(days=3)
    earlier = fill_at(vehicle, bunk, earlier_day)
    api.force_login(operator)

    day = earlier_day.date().isoformat()
    assert ids(api.get(FILLS, {"from": day, "to": day})) == [earlier.id]


def test_pump_fills_without_dates_are_this_month_in_india_time(api, operator, bunk, vehicle):
    start = current_month()
    just_after_midnight = datetime(start.year, start.month, 1, 0, 5, tzinfo=IST)
    just_before_midnight = just_after_midnight - timedelta(minutes=10)
    inside = fill_at(vehicle, bunk, just_after_midnight)
    fill_at(vehicle, bunk, just_before_midnight)
    api.force_login(operator)

    assert ids(api.get(FILLS)) == [inside.id]


def test_pump_fills_for_a_period_includes_both_days_in_india_time(api, operator, bunk, vehicle):
    first = fill_at(vehicle, bunk, datetime(2026, 9, 28, 0, 0, tzinfo=IST))
    last = fill_at(vehicle, bunk, datetime(2026, 10, 4, 23, 59, tzinfo=IST))
    fill_at(vehicle, bunk, datetime(2026, 10, 5, 0, 0, tzinfo=IST))
    fill_at(vehicle, bunk, datetime(2026, 9, 27, 23, 59, tzinfo=IST))
    api.force_login(operator)

    assert ids(api.get(FILLS, {"from": "2026-09-28", "to": "2026-10-04"})) == [last.id, first.id]


def test_pump_fills_refuses_a_bad_period(api, operator):
    api.force_login(operator)

    response = api.get(FILLS, {"from": "2026-10-05", "to": "2026-10-01"})

    assert response.status_code == 400
    assert response.json() == {"detail": "The first day must be on or before the last day."}


def test_pump_fills_is_empty_when_nothing_was_filled(api, operator):
    api.force_login(operator)

    assert api.get(FILLS).json() == []


@pytest.mark.parametrize(
    "make_user", [MTOFactory, PTOFactory, OfficerFactory, DriverFactory], ids=["mto", "pto", "officer", "driver"]
)
def test_only_pump_staff_can_list_pump_fills(api, make_user):
    api.force_login(make_user())

    assert api.get(FILLS).status_code == 403


def test_the_fill_response_and_the_fills_list_agree(api, operator, open_request):
    api.force_login(operator)
    filled = fill(api, open_request).json()

    [row] = api.get(FILLS).json()
    shared = ("id", "registration_number", "driver_name", "fuel_type", "litres_filled", "filled_at")
    assert {key: row[key] for key in shared} == {key: filled[key] for key in shared}
