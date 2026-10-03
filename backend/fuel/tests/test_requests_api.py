from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from common.months import IST, today_ist
from fleet import services
from fuel.models import FuelRequest, RequestStatus
from fuel.serializers import FuelRequestSerializer
from pumps.models import Pump, PumpKind
from testing.factories import (
    DriverFactory,
    FuelRequestFactory,
    MTOFactory,
    OfficerFactory,
    PTOFactory,
    PumpFactory,
    PumpStaffFactory,
    UnitFactory,
    VehicleFactory,
    filled_request,
    tieup_pump,
    unit_mto,
)

pytestmark = pytest.mark.django_db

URL = "/api/fuel/requests/"
FIELDS = {
    "id", "vehicle", "registration_number", "driver", "driver_name", "fuel_type", "litres_requested",
    "is_emergency", "emergency_reason", "status", "status_label", "issued_at", "expires_at", "pin",
    "failed_pin_attempts", "cancel_reason", "pump", "pump_name", "pump_kind", "filled_at", "litres_filled",
    "emergency_litres", "emergency_status", "emergency_status_label", "duty_particulars", "duty_submitted_at",
    "duty_due_at", "duty_overdue",
}


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def vehicle(mto):
    return VehicleFactory(
        unit=mto.unit,
        registration_number="AP39PA1234",
        tank_capacity_litres=Decimal("60"),
        monthly_fuel_limit_litres=Decimal("100"),
    )


@pytest.fixture
def driver(mto, vehicle, bunk):
    person = DriverFactory(unit=mto.unit, full_name="Ravi Kumar")
    services.assign_person(vehicle, person, mto)
    return person


@pytest.fixture
def officer(mto, vehicle):
    person = OfficerFactory(unit=mto.unit)
    services.assign_person(vehicle, person, mto)
    return person


@pytest.fixture
def bunk(mto):
    return tieup_pump(mto.unit)


def any_bunk_id():
    """The first tie-up bunk made (the `bunk` fixture's when the test has it), made now if there is none."""
    found = Pump.objects.filter(kind=PumpKind.TIE_UP).order_by("id").first()
    return (found or tieup_pump(UnitFactory())).id


def raise_request(api, litres="20", **extra):
    """Ask at a tie-up bunk (see `any_bunk_id`), unless `pump` is given."""
    extra.setdefault("pump", any_bunk_id())
    return api.post(URL, {"litres": litres, **extra})


def ids(response):
    return {row["id"] for row in response.json()}


def iso(value):
    return parse_datetime(value)


# --- raising a request -------------------------------------------------------------------------


def test_a_driver_raises_a_request_and_sees_the_pin(api, driver, vehicle):
    api.force_login(driver)

    response = raise_request(api, "20")

    assert response.status_code == 201
    body = response.json()
    assert set(body) == FIELDS
    assert body["vehicle"] == vehicle.id
    assert body["registration_number"] == "AP39PA1234"
    assert body["driver"] == driver.id
    assert body["driver_name"] == "Ravi Kumar"
    assert body["fuel_type"] == "DIESEL"
    assert body["litres_requested"] == "20.00"
    assert body["is_emergency"] is False
    assert body["emergency_reason"] == ""
    assert body["status"] == "ISSUED"
    assert body["status_label"] == "PIN issued"
    assert len(body["pin"]) == 6 and body["pin"].isdigit()
    assert body["failed_pin_attempts"] == 0
    assert body["cancel_reason"] == ""
    # issued_at is stamped when the row is saved, a moment after expires_at was worked out
    assert abs(iso(body["expires_at"]) - iso(body["issued_at"]) - timedelta(hours=24)) < timedelta(seconds=5)
    stored = FuelRequest.objects.get(pk=body["id"])
    assert stored.pin == body["pin"]
    assert stored.driver == driver


def test_a_new_request_names_its_pump_but_has_no_fill_or_duty_details_yet(api, driver, bunk):
    api.force_login(driver)

    body = raise_request(api, pump=bunk.id).json()

    assert body["pump"] == bunk.id
    assert body["pump_name"] == bunk.name
    assert body["pump_kind"] == "TIE_UP"
    assert body["filled_at"] is None
    assert body["litres_filled"] is None
    assert body["emergency_litres"] == "0.00"
    assert body["emergency_status"] == "NONE"
    assert body["emergency_status_label"] == "Not an emergency"
    assert body["duty_particulars"] == ""
    assert body["duty_submitted_at"] is None
    assert body["duty_due_at"] is None
    assert body["duty_overdue"] is False


@pytest.mark.parametrize("pump", [None, "", 999999, "abc"])
def test_a_request_must_name_a_pump_that_exists(api, driver, pump):
    api.force_login(driver)
    body = {"litres": "20"} if pump is None else {"litres": "20", "pump": pump}

    response = api.post(URL, body)

    assert response.status_code == 400
    assert response.json() == {"pump": ["Pick the pump you will fill at."]}
    assert not FuelRequest.objects.exists()


def test_whole_and_one_decimal_litres_are_accepted(api, driver):
    api.force_login(driver)

    assert raise_request(api, "20").json()["litres_requested"] == "20.00"
    FuelRequest.objects.all().delete()
    assert raise_request(api, 12.5).json()["litres_requested"] == "12.50"


def test_an_emergency_with_a_reason_is_marked_and_keeps_the_reason(api, driver, vehicle):
    filled_request(vehicle, Decimal("60"), timezone.now())
    filled_request(vehicle, Decimal("30"), timezone.now())  # 10 L left
    api.force_login(driver)

    response = raise_request(api, "18", is_emergency=True, emergency_reason="Flood duty at Kavali")

    assert response.status_code == 201
    body = response.json()
    assert body["is_emergency"] is True
    assert body["emergency_reason"] == "Flood duty at Kavali"


def test_an_unlinked_driver_gets_a_clear_message(api, mto):
    api.force_login(DriverFactory(unit=mto.unit))

    response = raise_request(api)

    assert response.status_code == 400
    assert response.json() == {"detail": "You are not linked to a vehicle. Contact your MTO."}


def test_a_paused_vehicle_gets_a_clear_message(api, driver, vehicle):
    vehicle.status = "PAUSED"
    vehicle.save()
    api.force_login(driver)

    response = raise_request(api)

    assert response.status_code == 400
    assert response.json() == {"detail": "This vehicle is paused or terminated."}


def test_more_than_the_tank_is_refused_with_the_capacity(api, driver):
    api.force_login(driver)

    response = raise_request(api, "60.01")

    assert response.status_code == 400
    assert response.json() == {"detail": "The tank holds only 60.00 L."}


def test_a_second_request_while_one_is_open_is_refused(api, driver):
    api.force_login(driver)
    assert raise_request(api).status_code == 201

    response = raise_request(api)

    assert response.status_code == 400
    assert response.json() == {
        "detail": "This vehicle already has an open request. Use its PIN or cancel it first."
    }
    assert FuelRequest.objects.count() == 1


def test_an_expired_open_request_is_expired_automatically_and_a_new_one_is_allowed(api, driver, vehicle):
    stale = FuelRequestFactory(vehicle=vehicle, driver=driver, expires_at=timezone.now() - timedelta(minutes=1))
    api.force_login(driver)

    response = raise_request(api)

    assert response.status_code == 201
    stale.refresh_from_db()
    assert stale.status == RequestStatus.EXPIRED


def test_more_than_is_left_without_an_emergency_is_refused_showing_the_numbers(api, driver, vehicle):
    filled_request(vehicle, Decimal("60"), timezone.now())
    filled_request(vehicle, Decimal("30"), timezone.now())  # 10 L left
    api.force_login(driver)

    response = raise_request(api, "15")

    assert response.status_code == 400
    assert response.json() == {
        "detail": "Only 10.00 L is left this month. Mark it as an emergency and give the reason to draw up to 20.00 L."
    }


def test_an_emergency_without_a_reason_is_refused(api, driver, vehicle):
    filled_request(vehicle, Decimal("60"), timezone.now())
    filled_request(vehicle, Decimal("30"), timezone.now())
    api.force_login(driver)

    response = raise_request(api, "15", is_emergency=True)

    assert response.status_code == 400
    assert response.json()["detail"].startswith("Only 10.00 L is left this month.")


def test_an_emergency_beyond_what_is_left_plus_ten_litres_is_refused(api, driver, vehicle):
    filled_request(vehicle, Decimal("60"), timezone.now())
    filled_request(vehicle, Decimal("30"), timezone.now())  # 10 L left
    api.force_login(driver)

    response = raise_request(api, "20.5", is_emergency=True, emergency_reason="Chase")

    assert response.status_code == 400
    assert response.json() == {"detail": "This vehicle can draw at most 20.00 L more this month."}


def test_a_second_emergency_in_the_month_can_use_only_what_is_left_of_the_ten_litres(api, driver, vehicle):
    filled_request(vehicle, Decimal("60"), timezone.now())
    filled_request(vehicle, Decimal("46"), timezone.now(), emergency_litres=Decimal("6"))
    api.force_login(driver)

    refused = raise_request(api, "5", is_emergency=True, emergency_reason="Chase")
    allowed = raise_request(api, "4", is_emergency=True, emergency_reason="Chase")

    assert refused.status_code == 400
    assert refused.json() == {"detail": "This vehicle can draw at most 4.00 L more this month."}
    assert allowed.status_code == 201
    assert allowed.json()["is_emergency"] is True


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"litres": ""},
        {"litres": "abc"},
        {"litres": "0"},
        {"litres": "-5"},
        {"litres": "10.123"},
        {"litres": "99999999"},
    ],
)
def test_litres_must_be_a_positive_number_with_at_most_two_decimals(api, driver, body):
    api.force_login(driver)

    response = api.post(URL, {**body, "pump": any_bunk_id()})

    assert response.status_code == 400
    assert set(response.json()) == {"litres"}
    assert FuelRequest.objects.count() == 0


def test_litres_greater_than_zero_message(api, driver):
    api.force_login(driver)

    assert raise_request(api, "0").json() == {"litres": ["Enter litres greater than 0."]}


def test_the_emergency_flag_must_be_true_or_false(api, driver):
    api.force_login(driver)

    response = raise_request(api, "10", is_emergency="maybe")

    assert response.status_code == 400
    assert set(response.json()) == {"is_emergency"}


@pytest.mark.parametrize("maker", [OfficerFactory, MTOFactory, PumpStaffFactory])
def test_only_drivers_can_raise_requests(api, maker):
    api.force_login(maker())

    assert raise_request(api).status_code == 403


def test_the_pto_cannot_raise_requests(api):
    api.force_login(PTOFactory())

    assert raise_request(api).status_code == 403


def test_a_request_must_be_made_while_signed_in(api):
    assert raise_request(api).status_code == 403
    assert api.get(URL).status_code == 403


# --- listing -----------------------------------------------------------------------------------


def test_the_driver_sees_only_their_own_requests_with_the_pin_of_the_open_one(api, driver, vehicle):
    open_request = FuelRequestFactory(vehicle=vehicle, driver=driver, pin="123456")
    cancelled = FuelRequestFactory(
        vehicle=vehicle, driver=driver, status=RequestStatus.CANCELLED, pin="654321",
    )
    FuelRequestFactory(vehicle=VehicleFactory(unit=vehicle.unit))  # another driver's request
    api.force_login(driver)

    response = api.get(URL)

    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()}
    assert set(rows) == {open_request.id, cancelled.id}
    assert rows[open_request.id]["pin"] == "123456"
    assert rows[cancelled.id]["pin"] is None
    assert set(rows[open_request.id]) == FIELDS


def test_the_driver_still_sees_requests_from_an_earlier_vehicle(api, mto, vehicle, driver):
    earlier = filled_request(vehicle, Decimal("10"), timezone.now(), driver=driver)
    services.end_assignment(driver.vehicle_assignments.get(ended_at__isnull=True), mto)
    other_vehicle = VehicleFactory(unit=mto.unit)
    services.assign_person(other_vehicle, driver, mto)
    now_request = FuelRequestFactory(vehicle=other_vehicle, driver=driver)
    api.force_login(driver)

    assert ids(api.get(URL)) == {earlier.id, now_request.id}


def test_only_the_driver_who_raised_an_open_request_is_shown_its_pin(vehicle, driver):
    # The list never shows a driver anyone else's request, so the serializer rule is checked on its own.
    someone_elses = FuelRequestFactory(vehicle=vehicle, pin="111111")
    open_one = FuelRequestFactory(vehicle=VehicleFactory(unit=vehicle.unit), driver=driver, pin="222222")

    def pin_seen_by(user, fuel_request):
        return FuelRequestSerializer(fuel_request, context={"request": SimpleNamespace(user=user)}).data["pin"]

    assert pin_seen_by(driver, open_one) == "222222"
    assert pin_seen_by(driver, someone_elses) is None
    assert pin_seen_by(someone_elses.driver, open_one) is None
    assert pin_seen_by(OfficerFactory(unit=vehicle.unit), open_one) is None


def test_the_pin_is_hidden_when_the_serializer_has_no_request_to_say_who_is_asking(driver, vehicle):
    open_one = FuelRequestFactory(vehicle=vehicle, driver=driver, pin="222222")

    assert FuelRequestSerializer(open_one).data["pin"] is None
    assert FuelRequestSerializer(open_one, context={}).data["pin"] is None


def test_the_officer_sees_requests_of_their_vehicles_without_the_pin(api, officer, driver, vehicle):
    mine = FuelRequestFactory(vehicle=vehicle, driver=driver, pin="123456")
    FuelRequestFactory(vehicle=VehicleFactory(unit=vehicle.unit))  # a vehicle the officer is not on
    api.force_login(officer)

    response = api.get(URL)

    assert response.status_code == 200
    rows = response.json()
    assert [row["id"] for row in rows] == [mine.id]
    assert rows[0]["pin"] is None
    assert rows[0]["driver_name"] == "Ravi Kumar"


def test_an_officer_who_is_no_longer_linked_sees_nothing(api, mto, officer, driver, vehicle):
    FuelRequestFactory(vehicle=vehicle, driver=driver)
    services.end_assignment(officer.vehicle_assignments.get(ended_at__isnull=True), mto)
    api.force_login(officer)

    assert api.get(URL).json() == []


def test_the_mto_sees_the_units_requests_without_the_pin(api, mto, vehicle, driver):
    mine = FuelRequestFactory(vehicle=vehicle, driver=driver, pin="123456")
    other_unit = FuelRequestFactory(vehicle=VehicleFactory(unit=UnitFactory()))
    api.force_login(mto)

    response = api.get(URL)

    assert response.status_code == 200
    assert ids(response) == {mine.id}
    assert other_unit.id not in ids(response)
    assert response.json()[0]["pin"] is None


def test_the_pto_sees_every_request(api, vehicle, driver):
    first = FuelRequestFactory(vehicle=vehicle, driver=driver)
    second = FuelRequestFactory(vehicle=VehicleFactory(unit=UnitFactory()))
    api.force_login(PTOFactory())

    response = api.get(URL)

    assert ids(response) == {first.id, second.id}
    assert all(row["pin"] is None for row in response.json())


def test_a_pump_operator_cannot_list_requests(api):
    api.force_login(PumpStaffFactory())

    assert api.get(URL).status_code == 403


def test_requests_are_listed_newest_first(api, driver, vehicle):
    old = FuelRequestFactory(vehicle=vehicle, driver=driver, status=RequestStatus.CANCELLED)
    new = FuelRequestFactory(vehicle=vehicle, driver=driver)
    api.force_login(driver)

    assert [row["id"] for row in api.get(URL).json()] == [new.id, old.id]


def test_listing_expires_requests_that_have_run_out(api, driver, vehicle):
    stale = FuelRequestFactory(vehicle=vehicle, driver=driver, expires_at=timezone.now() - timedelta(minutes=1))
    api.force_login(driver)

    row = api.get(URL).json()[0]

    assert row["id"] == stale.id
    assert row["status"] == "EXPIRED"
    assert row["status_label"] == "Expired"
    assert row["pin"] is None
    stale.refresh_from_db()
    assert stale.status == RequestStatus.EXPIRED


def test_a_filled_request_shows_the_pump_and_the_emergency_state(api, mto, driver, vehicle):
    pump = PumpFactory(unit=mto.unit, name="Police Pump Nellore")
    filled = filled_request(
        vehicle, Decimal("25"), timezone.now(), driver=driver, pump=pump, emergency_litres=Decimal("5")
    )
    api.force_login(mto)

    row = api.get(URL).json()[0]

    assert row["id"] == filled.id
    assert row["status"] == "FILLED"
    assert row["status_label"] == "Filled"
    assert row["pump"] == pump.id
    assert row["pump_name"] == "Police Pump Nellore"
    assert row["pump_kind"] == "POLICE"
    assert row["litres_filled"] == "25.00"
    assert row["emergency_litres"] == "5.00"
    assert row["emergency_status"] == "PENDING"
    assert row["emergency_status_label"] == "Waiting for MTO"
    assert row["is_emergency"] is True
    assert row["pin"] is None


def test_listing_uses_a_fixed_number_of_queries(api, mto, vehicle, driver, django_assert_max_num_queries):
    for _ in range(3):
        filled_request(vehicle, Decimal("5"), timezone.now(), driver=driver, pump=PumpFactory(unit=mto.unit))
    FuelRequestFactory(vehicle=vehicle, driver=driver)
    api.force_login(mto)
    with django_assert_max_num_queries(5):
        assert len(api.get(URL).json()) == 4

    FuelRequestFactory(vehicle=VehicleFactory(unit=mto.unit), status=RequestStatus.CANCELLED)
    with django_assert_max_num_queries(5):
        assert len(api.get(URL).json()) == 5


# --- filters -----------------------------------------------------------------------------------


def test_a_request_not_filled_belongs_to_the_day_it_was_raised_in_ist(api, mto, vehicle):
    in_june = FuelRequestFactory(vehicle=vehicle, status=RequestStatus.CANCELLED)
    late_june = FuelRequestFactory(vehicle=vehicle, status=RequestStatus.CANCELLED)
    in_july = FuelRequestFactory(vehicle=vehicle, status=RequestStatus.CANCELLED)
    FuelRequest.objects.filter(pk=in_june.pk).update(issued_at=datetime(2026, 6, 1, 0, 0, tzinfo=IST))
    FuelRequest.objects.filter(pk=late_june.pk).update(issued_at=datetime(2026, 6, 30, 23, 59, tzinfo=IST))
    FuelRequest.objects.filter(pk=in_july.pk).update(issued_at=datetime(2026, 7, 1, 0, 0, tzinfo=IST))
    api.force_login(mto)

    assert ids(api.get(URL, {"from": "2026-06-01", "to": "2026-06-30"})) == {in_june.id, late_june.id}
    assert ids(api.get(URL, {"from": "2026-07-01", "to": "2026-07-31"})) == {in_july.id}
    assert ids(api.get(URL, {"from": "2026-08-01", "to": "2026-08-31"})) == set()


def test_a_filled_request_belongs_to_the_day_it_was_filled(api, mto, vehicle):
    """Issued 30 Sep 22:00 IST, filled 1 Oct 01:00 IST: the fill counts in October's quota, so it is listed there."""
    crossing = filled_request(vehicle, Decimal("10"), datetime(2026, 10, 1, 1, 0, tzinfo=IST))
    FuelRequest.objects.filter(pk=crossing.pk).update(issued_at=datetime(2026, 9, 30, 22, 0, tzinfo=IST))
    still_open = FuelRequestFactory(vehicle=vehicle)
    FuelRequest.objects.filter(pk=still_open.pk).update(issued_at=datetime(2026, 9, 30, 22, 0, tzinfo=IST))
    api.force_login(mto)

    september = {"from": "2026-09-01", "to": "2026-09-30"}
    assert ids(api.get(URL, september)) == {still_open.id}  # unfilled: by the day it was raised
    assert ids(api.get(URL, {"from": "2026-10-01", "to": "2026-10-31"})) == {crossing.id}


def test_blank_dates_mean_no_date_filter(api, mto, vehicle):
    old = FuelRequestFactory(vehicle=vehicle, status=RequestStatus.CANCELLED)
    FuelRequest.objects.filter(pk=old.pk).update(issued_at=datetime(2026, 1, 5, tzinfo=IST))
    api.force_login(mto)

    assert ids(api.get(URL, {"from": "", "to": ""})) == {old.id}


def test_filter_by_period_includes_both_days_in_ist(api, mto, vehicle):
    """A filled request belongs to the day it was filled, one not filled yet to the day it was raised."""
    first_minute = filled_request(vehicle, Decimal("10"), datetime(2026, 9, 28, 0, 0, tzinfo=IST))
    last_minute = filled_request(vehicle, Decimal("10"), datetime(2026, 10, 4, 23, 59, tzinfo=IST))
    filled_request(vehicle, Decimal("10"), datetime(2026, 10, 5, 0, 0, tzinfo=IST))  # the day after
    filled_request(vehicle, Decimal("10"), datetime(2026, 9, 27, 23, 59, tzinfo=IST))  # the day before
    crossing = filled_request(vehicle, Decimal("10"), datetime(2026, 9, 28, 1, 0, tzinfo=IST))
    FuelRequest.objects.filter(pk=crossing.pk).update(issued_at=datetime(2026, 9, 27, 22, 0, tzinfo=IST))
    raised = FuelRequestFactory(vehicle=VehicleFactory(unit=mto.unit), status=RequestStatus.CANCELLED)
    FuelRequest.objects.filter(pk=raised.pk).update(issued_at=datetime(2026, 10, 1, 9, 0, tzinfo=IST))
    api.force_login(mto)

    found = ids(api.get(URL, {"from": "2026-09-28", "to": "2026-10-04"}))

    assert found == {first_minute.id, last_minute.id, crossing.id, raised.id}


def test_a_one_day_period(api, mto, vehicle):
    that_day = filled_request(vehicle, Decimal("10"), datetime(2026, 10, 3, 12, 0, tzinfo=IST))
    filled_request(vehicle, Decimal("10"), datetime(2026, 10, 4, 12, 0, tzinfo=IST))
    api.force_login(mto)

    assert ids(api.get(URL, {"from": "2026-10-03", "to": "2026-10-03"})) == {that_day.id}


@pytest.mark.parametrize(
    ("params", "message"),
    [
        ({"from": "2026-10-01"}, "Give both the first and the last day of the period."),
        ({"from": "2026-10-05", "to": "2026-10-01"}, "The first day must be on or before the last day."),
        ({"from": "2026-01-01", "to": "2027-06-30"}, "Pick a period of at most a year."),
        ({"from": "1/10/2026", "to": "2026-10-31"}, "Use dates in the format YYYY-MM-DD."),
    ],
)
def test_a_bad_period_is_refused(api, mto, params, message):
    api.force_login(mto)

    response = api.get(URL, params)

    assert response.status_code == 400
    assert response.json() == {"detail": message}


def test_the_pto_can_narrow_the_list_to_one_office(api, vehicle):
    mine = filled_request(vehicle, Decimal("10"), timezone.now())
    filled_request(VehicleFactory(unit=UnitFactory()), Decimal("10"), timezone.now())
    api.force_login(PTOFactory())

    assert ids(api.get(URL, {"unit": str(vehicle.unit_id)})) == {mine.id}
    assert len(api.get(URL).json()) == 2


def test_an_mto_asking_for_another_office_gets_nothing(api, mto, vehicle):
    filled_request(vehicle, Decimal("10"), timezone.now())
    api.force_login(mto)

    assert api.get(URL, {"unit": str(UnitFactory().pk)}).json() == []


def test_a_bad_office_filter_is_refused(api, mto):
    api.force_login(mto)

    response = api.get(URL, {"unit": "Nellore"})

    assert response.status_code == 400
    assert response.json() == {"detail": "Use the office's id."}


def test_todays_filter_finds_a_request_raised_now(api, driver):
    api.force_login(driver)
    created = raise_request(api).json()
    today = today_ist().isoformat()

    assert ids(api.get(URL, {"from": today, "to": today})) == {created["id"]}


def test_filter_by_status(api, mto, vehicle):
    open_request = FuelRequestFactory(vehicle=vehicle)
    cancelled = FuelRequestFactory(vehicle=vehicle, status=RequestStatus.CANCELLED)
    filled = filled_request(vehicle, Decimal("5"), timezone.now())
    api.force_login(mto)

    assert ids(api.get(URL, {"status": "ISSUED"})) == {open_request.id}
    assert ids(api.get(URL, {"status": "CANCELLED"})) == {cancelled.id}
    assert ids(api.get(URL, {"status": "FILLED"})) == {filled.id}
    assert ids(api.get(URL, {"status": "EXPIRED"})) == set()


def test_filter_by_vehicle(api, mto, vehicle):
    mine = FuelRequestFactory(vehicle=vehicle, status=RequestStatus.CANCELLED)
    other_vehicle = VehicleFactory(unit=mto.unit)
    other = FuelRequestFactory(vehicle=other_vehicle)
    api.force_login(mto)

    assert ids(api.get(URL, {"vehicle": vehicle.id})) == {mine.id}
    assert ids(api.get(URL, {"vehicle": other_vehicle.id})) == {other.id}


def test_filter_by_a_vehicle_outside_the_scope_finds_nothing(api, mto):
    elsewhere = FuelRequestFactory(vehicle=VehicleFactory(unit=UnitFactory()))
    api.force_login(mto)

    assert api.get(URL, {"vehicle": elsewhere.vehicle_id}).json() == []


def test_a_vehicle_filter_must_be_an_id(api, mto):
    api.force_login(mto)

    response = api.get(URL, {"vehicle": "AP39PA1234"})

    assert response.status_code == 400
    assert response.json() == {"detail": "Use the vehicle's id."}


# --- duty particulars --------------------------------------------------------------------------


def test_duty_is_due_48_hours_after_the_fill(api, mto, driver, vehicle):
    filled_at = timezone.now() - timedelta(hours=10)
    filled_request(vehicle, Decimal("10"), filled_at, driver=driver)
    api.force_login(driver)

    row = api.get(URL).json()[0]

    assert iso(row["filled_at"]) == filled_at
    assert iso(row["duty_due_at"]) == filled_at + timedelta(hours=48)
    assert row["duty_overdue"] is False


def test_duty_is_overdue_when_nothing_was_entered_after_48_hours(api, driver, vehicle):
    filled_request(vehicle, Decimal("10"), timezone.now() - timedelta(hours=49), driver=driver)
    api.force_login(driver)

    assert api.get(URL).json()[0]["duty_overdue"] is True


def test_duty_is_not_overdue_once_it_was_entered_even_late(api, driver, vehicle):
    filled = filled_request(vehicle, Decimal("10"), timezone.now() - timedelta(hours=60), driver=driver)
    filled.duty_particulars = "Escort duty, Kavali"
    filled.duty_submitted_at = timezone.now() - timedelta(hours=1)
    filled.save()
    api.force_login(driver)

    row = api.get(URL).json()[0]

    assert row["duty_overdue"] is False
    assert row["duty_particulars"] == "Escort duty, Kavali"
    assert iso(row["duty_submitted_at"]) == filled.duty_submitted_at


# --- cancelling --------------------------------------------------------------------------------


def cancel_url(request_id):
    return f"{URL}{request_id}/cancel/"


def test_the_driver_cancels_an_open_request_and_the_pin_is_no_longer_shown(api, driver, vehicle):
    open_request = FuelRequestFactory(vehicle=vehicle, driver=driver, pin="123456")
    api.force_login(driver)

    response = api.post(cancel_url(open_request.id))

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == open_request.id
    assert body["status"] == "CANCELLED"
    assert body["status_label"] == "Cancelled"
    assert body["cancel_reason"] == "Cancelled by the driver."
    assert body["pin"] is None
    open_request.refresh_from_db()
    assert open_request.status == RequestStatus.CANCELLED
    listed = api.get(URL).json()[0]
    assert listed["pin"] is None


def test_after_cancelling_the_driver_can_raise_a_new_request(api, driver):
    api.force_login(driver)
    first = raise_request(api).json()
    api.post(cancel_url(first["id"]))

    assert raise_request(api).status_code == 201


def test_cancelling_a_filled_request_is_refused(api, driver, vehicle):
    filled = filled_request(vehicle, Decimal("10"), timezone.now(), driver=driver)
    api.force_login(driver)

    response = api.post(cancel_url(filled.id))

    assert response.status_code == 400
    assert response.json() == {"detail": "Only an open request can be cancelled."}
    filled.refresh_from_db()
    assert filled.status == RequestStatus.FILLED


def test_cancelling_twice_is_refused(api, driver, vehicle):
    open_request = FuelRequestFactory(vehicle=vehicle, driver=driver)
    api.force_login(driver)
    assert api.post(cancel_url(open_request.id)).status_code == 200

    response = api.post(cancel_url(open_request.id))

    assert response.status_code == 400
    assert response.json() == {"detail": "Only an open request can be cancelled."}


def test_another_drivers_request_cannot_be_cancelled(api, mto, vehicle, driver):
    theirs = FuelRequestFactory(vehicle=vehicle, driver=driver)
    api.force_login(DriverFactory(unit=mto.unit))

    assert api.post(cancel_url(theirs.id)).status_code == 404
    theirs.refresh_from_db()
    assert theirs.status == RequestStatus.ISSUED


@pytest.mark.parametrize(
    "person",
    [
        lambda unit: OfficerFactory(unit=unit),
        lambda unit: unit_mto(unit),
        lambda unit: PumpStaffFactory(unit=unit),
        lambda unit: PTOFactory(),
    ],
    ids=["officer", "mto", "pump-operator", "pto"],
)
def test_other_roles_cannot_cancel_a_drivers_request(api, vehicle, driver, person):
    theirs = FuelRequestFactory(vehicle=vehicle, driver=driver)
    api.force_login(person(vehicle.unit))

    assert api.post(cancel_url(theirs.id)).status_code == 404
    theirs.refresh_from_db()
    assert theirs.status == RequestStatus.ISSUED


def test_cancelling_a_request_that_does_not_exist_is_404(api, driver):
    api.force_login(driver)

    assert api.post(cancel_url(999999)).status_code == 404


def test_cancel_is_post_only(api, driver, vehicle):
    open_request = FuelRequestFactory(vehicle=vehicle, driver=driver)
    api.force_login(driver)

    assert api.get(cancel_url(open_request.id)).status_code == 405
    assert api.delete(f"{URL}{open_request.id}/").status_code == 404
