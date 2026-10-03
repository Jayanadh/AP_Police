from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import serializers

from accounts import transfers
from accounts.models import Role, UserStatus
from approvals import services as approval_services
from common.months import IST, current_month, format_month, month_bounds, today_ist
from dashboards import summaries
from fleet import services as fleet_services
from fleet.models import FuelType, VehicleStatus
from fleet.odometer import week_of
from fuel.models import EmergencyStatus, FuelRequest, RequestStatus
from testing.factories import (
    DriverFactory,
    FuelGrantFactory,
    FuelRequestFactory,
    MTOFactory,
    OdometerReadingFactory,
    OfficerFactory,
    PTOFactory,
    PumpFactory,
    PumpStaffFactory,
    UnitFactory,
    VehicleFactory,
    driver_on,
    filled_request,
    police_pump,
    tieup_pump,
)

pytestmark = pytest.mark.django_db

URL = "/api/dashboard/"
NOW = datetime(2026, 10, 15, 12, 0, tzinfo=IST)  # a Thursday; its Sunday is 11 October


def ist(month: int, day: int, hour: int = 12, minute: int = 0) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=IST)


def ago(**delta) -> datetime:
    """A moment `delta` before now, kept inside the current month so the tests agree with the clock on the 1st."""
    month_begins, _ = month_bounds(current_month())
    return max(timezone.now() - timedelta(**delta), month_begins + timedelta(seconds=1))


def iso(value: datetime) -> str:
    """A moment as the API writes it."""
    return serializers.DateTimeField().to_representation(value)


def dashboard(user, api):
    api.force_login(user)
    response = api.get(URL)
    assert response.status_code == 200, response.content
    return response.json()


def stocked(unit, name, petrol, diesel):
    """A police pump of `unit` called `name` with the given stock."""
    pump = PumpFactory(unit=unit, name=name)
    pump.tanks.filter(fuel_type=FuelType.PETROL).update(current_stock_litres=Decimal(petrol))
    pump.tanks.filter(fuel_type=FuelType.DIESEL).update(current_stock_litres=Decimal(diesel))
    return pump


# --- who may read it, and what every dashboard starts with ---------------------------------------------------


def test_the_dashboard_needs_a_login(api):
    assert api.get(URL).status_code == 403


@pytest.mark.parametrize(
    "factory, role",
    [
        (PTOFactory, Role.PTO),
        (MTOFactory, Role.MTO),
        (OfficerFactory, Role.OFFICER),
        (DriverFactory, Role.DRIVER),
        (PumpStaffFactory, Role.PUMP_OPERATOR),
    ],
)
def test_every_role_gets_its_role_and_the_current_month(api, factory, role):
    body = dashboard(factory(), api)

    assert body["role"] == role
    assert body["month"] == format_month(current_month())


# --- PTO -----------------------------------------------------------------------------------------------------


def test_pto_sees_every_office_with_totals(api):
    pto = PTOFactory()
    alpha = UnitFactory(name="Alpha Range", code="ALP")
    beta = UnitFactory(name="Beta Range", code="BET")
    mto = MTOFactory(unit=alpha)
    active = VehicleFactory(unit=alpha, monthly_fuel_limit_litres=Decimal("100"))
    paused = VehicleFactory(unit=alpha, status=VehicleStatus.PAUSED, monthly_fuel_limit_litres=Decimal("50"))
    leaving = VehicleFactory(unit=alpha, monthly_fuel_limit_litres=Decimal("30"))
    approval_services.request_vehicle_termination(leaving, mto, "Beyond repair")  # TERMINATION_PENDING, one approval
    terminated = VehicleFactory(unit=alpha, status=VehicleStatus.TERMINATED, monthly_fuel_limit_litres=Decimal("999"))
    FuelGrantFactory(vehicle=active, litres=Decimal("30"))  # this month
    pump = stocked(alpha, "Alpha Pump", "500", "40")  # one tank is low
    filled_request(active, Decimal("40"), ago(minutes=5), pump=pump, emergency_litres=Decimal("5"))  # pending
    filled_request(paused, Decimal("15"), ago(minutes=6), pump=pump)
    filled_request(terminated, Decimal("99"), ago(minutes=7), pump=pump)
    FuelRequest.objects.filter(vehicle=terminated).update(  # drew fuel, but last month
        filled_at=month_bounds(current_month())[0] - timedelta(days=5)
    )
    approval_services.request_officer_approval(
        OfficerFactory(unit=beta, status=UserStatus.PENDING_APPROVAL), MTOFactory(unit=beta)
    )

    body = dashboard(pto, api)

    assert set(body) == {"role", "month", "units", "pending_approvals", "totals"}
    assert body["pending_approvals"] == 2
    alpha_row, beta_row = body["units"]
    assert alpha_row == {
        "id": alpha.id,
        "name": "Alpha Range",
        "code": "ALP",
        "vehicles_active": 1,
        "vehicles_paused": 1,
        "fuel_used_litres": "55.00",
        "fuel_limit_litres": "210.00",  # 100 + 30 extra + 50 + 30; the terminated vehicle drew nothing this month
        "low_stock_tanks": 1,
        "pending_emergencies": 1,
    }
    assert beta_row == {
        "id": beta.id,
        "name": "Beta Range",
        "code": "BET",
        "vehicles_active": 0,
        "vehicles_paused": 0,
        "fuel_used_litres": "0.00",
        "fuel_limit_litres": "0.00",
        "low_stock_tanks": 0,
        "pending_emergencies": 0,
    }
    assert body["totals"] == {
        "vehicles_active": 1,
        "fuel_used_litres": "55.00",
        "fuel_limit_litres": "210.00",
        "low_stock_tanks": 1,
    }


def test_pto_fuel_still_counts_a_vehicle_terminated_after_it_drew_fuel_this_month(api):
    """Its fills happened, so its litres stay in the month's total and its limit comes with them (used never outruns
    the limit); a terminated vehicle that drew nothing this month counts nowhere."""
    pto = PTOFactory()
    alpha = UnitFactory(name="Alpha Range", code="ALP")
    beta = UnitFactory(name="Beta Range", code="BET")
    pump = PumpFactory(unit=alpha)
    live = VehicleFactory(unit=alpha, monthly_fuel_limit_litres=Decimal("100"))
    gone = VehicleFactory(unit=alpha, monthly_fuel_limit_litres=Decimal("60"))
    idle = VehicleFactory(unit=alpha, monthly_fuel_limit_litres=Decimal("500"))
    other = VehicleFactory(unit=beta, monthly_fuel_limit_litres=Decimal("30"))
    filled_request(live, Decimal("10"), ago(minutes=5), pump=pump)
    filled_request(gone, Decimal("40"), ago(minutes=6), pump=pump)
    filled_request(other, Decimal("7"), ago(minutes=7), pump=PumpFactory(unit=beta))
    for vehicle in (gone, idle):
        vehicle.status = VehicleStatus.TERMINATED
        vehicle.save()

    body = dashboard(pto, api)

    alpha_row, beta_row = body["units"]
    assert (alpha_row["fuel_used_litres"], alpha_row["fuel_limit_litres"]) == ("50.00", "160.00")
    assert alpha_row["vehicles_active"] == 1
    assert (beta_row["fuel_used_litres"], beta_row["fuel_limit_litres"]) == ("7.00", "30.00")
    assert body["totals"]["fuel_used_litres"] == "57.00"
    assert body["totals"]["fuel_limit_litres"] == "190.00"


def test_pto_with_no_offices_gets_zeros(api):
    body = dashboard(PTOFactory(), api)

    assert body["units"] == []
    assert body["pending_approvals"] == 0
    assert body["totals"] == {
        "vehicles_active": 0,
        "fuel_used_litres": "0.00",
        "fuel_limit_litres": "0.00",
        "low_stock_tanks": 0,
    }


def test_pto_counts_only_pending_approvals(api):
    pto = PTOFactory()
    mto = MTOFactory()
    vehicle = VehicleFactory(unit=mto.unit)
    approval = approval_services.request_vehicle_termination(vehicle, mto, "Beyond repair")
    approval_services.decide(approval, pto, approve=False, note="Keep it")

    assert dashboard(pto, api)["pending_approvals"] == 0


def test_pto_dashboard_asks_the_same_questions_for_any_number_of_offices(api):
    pto = PTOFactory()
    api.force_login(pto)

    def queries() -> int:
        with CaptureQueriesContext(connection) as captured:
            assert api.get(URL).status_code == 200
        return len(captured)

    def office():
        unit = UnitFactory()
        vehicle = VehicleFactory(unit=unit)
        pump = police_pump(unit, petrol=Decimal("10"), diesel=Decimal("10"))
        filled_request(vehicle, Decimal("5"), ago(minutes=5), pump=pump, emergency_litres=Decimal("1"))

    office()
    office()
    few = queries()
    for _ in range(4):
        office()

    assert queries() == few


# --- MTO -----------------------------------------------------------------------------------------------------


def test_mto_dashboard_counts_the_offices_own_work(api):
    mto = MTOFactory()
    unit = mto.unit
    elsewhere = UnitFactory()
    now = timezone.now()
    last_week = week_of(today_ist()) - timedelta(weeks=1)

    no_reading = VehicleFactory(unit=unit)  # an active vehicle with a driver and no reading this week
    driver_on(no_reading)
    due = VehicleFactory(unit=unit, odometer_at_onboarding_km=10000, service_interval_km=5000)
    driver_on(due)
    OdometerReadingFactory(vehicle=due, week_of=last_week, reading_km=16000)  # 6000 km since onboarding
    OdometerReadingFactory(vehicle=due, reading_km=16000)  # this week's: recorded
    pump = stocked(unit, "Alpha Pump", "500", "40")  # the diesel tank is low

    filled_request(no_reading, Decimal("25"), now, pump=pump, emergency_litres=Decimal("5"))  # emergency waiting
    filled_request(due, Decimal("10"), now - timedelta(days=3), pump=pump)  # no duty particulars after 3 days
    filled_request(due, Decimal("10"), now - timedelta(days=3), pump=pump, duty_submitted_at=now, duty_particulars="x")
    filled_request(due, Decimal("10"), now - timedelta(hours=1), pump=pump)  # duty not due yet
    other_mto = MTOFactory(unit=elsewhere)
    transfers.request_transfer(OfficerFactory(unit=unit), elsewhere, other_mto)  # for this office to decide
    for _ in range(2):  # asked by this office: nothing for it to decide
        transfers.request_transfer(OfficerFactory(unit=elsewhere), unit, mto)

    # Other offices' work is not counted.
    stranger = VehicleFactory(unit=elsewhere)
    driver_on(stranger)
    filled_request(stranger, Decimal("5"), now - timedelta(days=3), emergency_litres=Decimal("1"))
    far_due = VehicleFactory(unit=elsewhere, odometer_at_onboarding_km=10000, service_interval_km=5000)
    driver_on(far_due)
    OdometerReadingFactory(vehicle=far_due, reading_km=16000)  # due for a service, but not this office's
    stocked(elsewhere, "Far Pump", "1", "1")

    body = dashboard(mto, api)

    assert set(body) == {
        "role", "month", "vehicles", "fuel", "top_vehicles", "tanks", "pending_emergencies", "overdue_duty",
        "missing_odometer", "services_due", "transfers_to_decide",
    }
    assert body["pending_emergencies"] == 1
    assert body["overdue_duty"] == 1
    assert body["missing_odometer"] == 1
    assert body["services_due"] == 1
    assert body["transfers_to_decide"] == 1
    assert [tank["is_low"] for tank in body["tanks"]] == [False, True]
    assert body["vehicles"] == {"active": 2, "paused": 0, "termination_pending": 0}


def test_mto_with_no_vehicles_or_pumps_gets_zeros_and_empty_lists(api):
    body = dashboard(MTOFactory(), api)

    assert body == {
        "role": "MTO",
        "month": format_month(current_month()),
        "vehicles": {"active": 0, "paused": 0, "termination_pending": 0},
        "fuel": {"used_litres": "0.00", "limit_litres": "0.00"},
        "top_vehicles": [],
        "tanks": [],
        "pending_emergencies": 0,
        "overdue_duty": 0,
        "missing_odometer": 0,
        "services_due": 0,
        "transfers_to_decide": 0,
    }


def test_mto_fuel_is_this_months_litres_over_the_unit_s_vehicles_that_are_not_terminated_or_drew_fuel_this_month():
    mto = MTOFactory()
    unit = mto.unit
    pump = PumpFactory(unit=unit)
    a = VehicleFactory(unit=unit, registration_number="AP39AA0001", monthly_fuel_limit_litres=Decimal("100"))
    b = VehicleFactory(unit=unit, registration_number="AP39AA0002", monthly_fuel_limit_litres=Decimal("60"))
    paused = VehicleFactory(unit=unit, status=VehicleStatus.PAUSED, monthly_fuel_limit_litres=Decimal("40"))
    leaving = VehicleFactory(
        unit=unit, status=VehicleStatus.TERMINATION_PENDING, monthly_fuel_limit_litres=Decimal("10")
    )
    f, g, h = (
        VehicleFactory(unit=unit, registration_number=f"AP39AA000{n}", monthly_fuel_limit_litres=Decimal("5"))
        for n in (3, 4, 5)
    )
    terminated = VehicleFactory(unit=unit, status=VehicleStatus.TERMINATED, monthly_fuel_limit_litres=Decimal("500"))
    FuelGrantFactory(vehicle=a, month=date(2026, 10, 1), litres=Decimal("30"))
    FuelGrantFactory(vehicle=a, month=date(2026, 9, 1), litres=Decimal("77"))  # last month's extra
    filled_request(a, Decimal("50"), ist(10, 3), pump=pump)
    filled_request(a, Decimal("70"), ist(10, 9), pump=pump)
    filled_request(a, Decimal("40"), datetime(2026, 9, 30, 23, 59, tzinfo=IST), pump=pump)  # last month
    filled_request(b, Decimal("20"), ist(10, 10), pump=pump)
    filled_request(leaving, Decimal("10"), ist(10, 10), pump=pump)
    for vehicle, litres in ((f, 1), (g, 2), (h, 3)):
        filled_request(vehicle, Decimal(litres), ist(10, 11), pump=pump)
    filled_request(terminated, Decimal("200"), ist(9, 28), pump=pump)  # drew fuel, but last month

    body = summaries.mto_summary(mto, NOW)

    assert body["vehicles"] == {"active": 5, "paused": 1, "termination_pending": 1}
    assert body["fuel"] == {"used_litres": "156.00", "limit_litres": "255.00"}
    assert body["top_vehicles"] == [  # five of seven, most litres first; no terminated vehicle, no idle one
        {"id": a.id, "registration_number": "AP39AA0001", "used_litres": "120.00", "limit_litres": "130.00"},
        {"id": b.id, "registration_number": "AP39AA0002", "used_litres": "20.00", "limit_litres": "60.00"},
        {"id": leaving.id, "registration_number": leaving.registration_number, "used_litres": "10.00",
         "limit_litres": "10.00"},
        {"id": h.id, "registration_number": "AP39AA0005", "used_litres": "3.00", "limit_litres": "5.00"},
        {"id": g.id, "registration_number": "AP39AA0004", "used_litres": "2.00", "limit_litres": "5.00"},
    ]
    assert paused.pk not in {row["id"] for row in body["top_vehicles"]}


def test_mto_fuel_still_counts_a_vehicle_terminated_after_it_drew_fuel_this_month():
    """Its fills happened, so its litres stay in the month's total and its limit comes with them; it is no longer a
    vehicle of the fleet, so it is not listed among the top vehicles."""
    mto = MTOFactory()
    pump = PumpFactory(unit=mto.unit)
    live = VehicleFactory(unit=mto.unit, monthly_fuel_limit_litres=Decimal("100"))
    gone = VehicleFactory(unit=mto.unit, monthly_fuel_limit_litres=Decimal("60"))
    idle = VehicleFactory(unit=mto.unit, monthly_fuel_limit_litres=Decimal("500"))
    filled_request(live, Decimal("10"), ist(10, 5), pump=pump)
    filled_request(gone, Decimal("40"), ist(10, 6), pump=pump)
    for vehicle in (gone, idle):
        vehicle.status = VehicleStatus.TERMINATED
        vehicle.save()

    body = summaries.mto_summary(mto, NOW)

    assert body["fuel"] == {"used_litres": "50.00", "limit_litres": "160.00"}
    assert [row["id"] for row in body["top_vehicles"]] == [live.id]
    assert body["vehicles"] == {"active": 1, "paused": 0, "termination_pending": 0}


def test_mto_tanks_are_the_police_tanks_of_the_unit_by_pump(api):
    mto = MTOFactory()
    unit = mto.unit
    beta = stocked(unit, "Beta Pump", "100", "99.99")  # exactly the alert level is not low
    alpha = stocked(unit, "Alpha Pump", "500", "40")
    alpha.tanks.filter(fuel_type=FuelType.PETROL).update(capacity_litres=Decimal("5000"))
    tieup_pump(unit)
    stocked(UnitFactory(), "Far Pump", "1", "1")

    body = dashboard(mto, api)

    def expected(pump, fuel_type, stock, is_low, capacity=None):
        tank = pump.tanks.get(fuel_type=fuel_type)
        return {
            "id": tank.id,
            "pump_name": pump.name,
            "fuel_type": fuel_type,
            "current_stock_litres": stock,
            "low_stock_threshold_litres": "100.00",
            "capacity_litres": capacity,
            "is_low": is_low,
        }

    assert body["tanks"] == [
        expected(alpha, "PETROL", "500.00", False, capacity="5000.00"),
        expected(alpha, "DIESEL", "40.00", True),  # no capacity set: null
        expected(beta, "PETROL", "100.00", False),
        expected(beta, "DIESEL", "99.99", True),
    ]


def test_mto_vehicle_counts_by_status():
    mto = MTOFactory()
    for status in (VehicleStatus.ACTIVE, VehicleStatus.ACTIVE, VehicleStatus.PAUSED, VehicleStatus.TERMINATION_PENDING,
                   VehicleStatus.TERMINATED):
        VehicleFactory(unit=mto.unit, status=status)
    VehicleFactory(unit=UnitFactory())

    assert summaries.mto_summary(mto, NOW)["vehicles"] == {"active": 2, "paused": 1, "termination_pending": 1}


def test_mto_missing_odometer_follows_the_sunday_of_the_week():
    mto = MTOFactory()
    sunday = date(2026, 10, 11)
    recorded = VehicleFactory(unit=mto.unit)
    driver_on(recorded)
    OdometerReadingFactory(vehicle=recorded, week_of=sunday)
    old_reading = VehicleFactory(unit=mto.unit)
    driver_on(old_reading)
    OdometerReadingFactory(vehicle=old_reading, week_of=date(2026, 10, 4))  # last week's: this week is missing
    VehicleFactory(unit=mto.unit)  # no driver: nobody to enter a reading
    paused = VehicleFactory(unit=mto.unit, status=VehicleStatus.PAUSED)
    driver_on(paused)

    assert summaries.mto_summary(mto, NOW)["missing_odometer"] == 1
    assert summaries.mto_summary(mto, ist(10, 18))["missing_odometer"] == 2  # a new week starts on Sunday 18 October


def test_duty_particulars_are_overdue_from_48_hours_after_the_fill():
    mto = MTOFactory()
    vehicle = VehicleFactory(unit=mto.unit)
    driver = driver_on(vehicle)
    pump = PumpFactory(unit=mto.unit)
    almost = filled_request(vehicle, Decimal("5"), NOW - timedelta(hours=47, minutes=59), driver=driver, pump=pump)
    exactly = filled_request(vehicle, Decimal("6"), NOW - timedelta(hours=48), driver=driver, pump=pump)
    late = filled_request(vehicle, Decimal("7"), NOW - timedelta(hours=48, minutes=1), driver=driver, pump=pump)
    filled_request(
        vehicle, Decimal("8"), NOW - timedelta(hours=72), driver=driver, pump=pump, duty_submitted_at=NOW,
        duty_particulars="Escort duty",
    )
    filled_request(vehicle, Decimal("9"), NOW - timedelta(hours=96), pump=pump)  # another driver's, also overdue

    assert summaries.mto_summary(mto, NOW)["overdue_duty"] == 3  # not the one that is 1 minute short of 48 hours
    assert summaries.driver_summary(driver, NOW)["duty_due"] == [
        {
            "id": late.id,
            "registration_number": vehicle.registration_number,
            "filled_at": iso(late.filled_at),
            "litres_filled": "7.00",
            "duty_due_at": iso(late.filled_at + timedelta(hours=48)),
            "duty_overdue": True,
        },
        {
            "id": exactly.id,
            "registration_number": vehicle.registration_number,
            "filled_at": iso(exactly.filled_at),
            "litres_filled": "6.00",
            "duty_due_at": iso(exactly.filled_at + timedelta(hours=48)),
            "duty_overdue": True,  # two days have passed: due and overdue are the same moment
        },
        {
            "id": almost.id,
            "registration_number": vehicle.registration_number,
            "filled_at": iso(almost.filled_at),
            "litres_filled": "5.00",
            "duty_due_at": iso(almost.filled_at + timedelta(hours=48)),
            "duty_overdue": False,
        },
    ]


def test_mto_emergencies_counted_are_the_ones_waiting_for_the_mto():
    mto = MTOFactory()
    vehicle = VehicleFactory(unit=mto.unit)
    pump = PumpFactory(unit=mto.unit)
    filled_request(vehicle, Decimal("20"), ist(10, 3), pump=pump, emergency_litres=Decimal("5"))
    filled_request(
        vehicle, Decimal("20"), ist(10, 4), pump=pump, emergency_litres=Decimal("5"),
        emergency_status=EmergencyStatus.ALLOWED,
    )
    filled_request(vehicle, Decimal("20"), ist(10, 5), pump=pump)

    assert summaries.mto_summary(mto, NOW)["pending_emergencies"] == 1


# --- OFFICER -------------------------------------------------------------------------------------------------


def test_officer_sees_own_vehicles_with_quota_and_recent_fills(api):
    unit = UnitFactory()
    officer = OfficerFactory(unit=unit)
    mto = MTOFactory(unit=unit)
    jeep = VehicleFactory(unit=unit, registration_number="AP39AA0001", make="Mahindra", model="Bolero",
                          monthly_fuel_limit_litres=Decimal("100"))
    van = VehicleFactory(unit=unit, registration_number="AP39AA0002", make="Tata", model="Winger",
                         monthly_fuel_limit_litres=Decimal("60"))
    fleet_services.assign_person(jeep, officer, mto)
    fleet_services.assign_person(van, officer, mto)
    driver = DriverFactory(unit=unit, full_name="Ramu Naidu")
    fleet_services.assign_person(jeep, driver, mto)  # the van has no driver
    FuelGrantFactory(vehicle=jeep, litres=Decimal("30"))
    stranger = VehicleFactory(unit=unit)  # another officer's vehicle
    fleet_services.assign_person(stranger, OfficerFactory(unit=unit), mto)
    ended = VehicleFactory(unit=unit)  # a vehicle this officer used to have
    fleet_services.end_assignment(fleet_services.assign_person(ended, officer, mto), mto)
    pump = PumpFactory(unit=unit, name="Alpha Pump")
    first = filled_request(jeep, Decimal("10"), ago(minutes=2), driver=driver, pump=pump, duty_particulars="Escort")
    second = filled_request(jeep, Decimal("20"), ago(minutes=1), driver=driver, pump=pump)
    filled_request(stranger, Decimal("3"), ago(minutes=1), pump=pump)
    filled_request(ended, Decimal("4"), ago(minutes=1), pump=pump)

    body = dashboard(officer, api)

    assert set(body) == {"role", "month", "vehicles", "recent_fills"}
    assert body["vehicles"] == [
        {
            "id": jeep.id,
            "registration_number": "AP39AA0001",
            "make": "Mahindra",
            "model": "Bolero",
            "driver_name": "Ramu Naidu",
            "limit_litres": "130.00",
            "used_litres": "30.00",
            "remaining_litres": "100.00",
        },
        {
            "id": van.id,
            "registration_number": "AP39AA0002",
            "make": "Tata",
            "model": "Winger",
            "driver_name": None,
            "limit_litres": "60.00",
            "used_litres": "0.00",
            "remaining_litres": "60.00",
        },
    ]
    fills = {fill["id"]: fill for fill in body["recent_fills"]}
    assert set(fills) == {first.id, second.id}
    assert fills[first.id] == {
        "id": first.id,
        "registration_number": "AP39AA0001",
        "litres_filled": "10.00",
        "filled_at": iso(first.filled_at),
        "pump_name": "Alpha Pump",
        "duty_particulars": "Escort",
    }
    assert fills[second.id]["duty_particulars"] == ""


def test_officer_recent_fills_are_the_last_ten_newest_first():
    unit = UnitFactory()
    officer = OfficerFactory(unit=unit)
    vehicle = VehicleFactory(unit=unit)
    fleet_services.assign_person(vehicle, officer, MTOFactory(unit=unit))
    pump = PumpFactory(unit=unit)
    fills = [filled_request(vehicle, Decimal("1"), NOW - timedelta(hours=hour), pump=pump) for hour in range(11)]

    body = summaries.officer_summary(officer, NOW)

    assert [fill["id"] for fill in body["recent_fills"]] == [fill.id for fill in fills[:10]]


def test_officer_without_vehicles_gets_empty_lists(api):
    body = dashboard(OfficerFactory(), api)

    assert body["vehicles"] == []
    assert body["recent_fills"] == []


def test_officer_vehicle_used_litres_start_again_each_month():
    unit = UnitFactory()
    officer = OfficerFactory(unit=unit)
    vehicle = VehicleFactory(unit=unit, monthly_fuel_limit_litres=Decimal("100"))
    fleet_services.assign_person(vehicle, officer, MTOFactory(unit=unit))
    filled_request(vehicle, Decimal("40"), datetime(2026, 9, 30, 23, 59, tzinfo=IST))
    filled_request(vehicle, Decimal("15"), ist(10, 2))

    row = summaries.officer_summary(officer, NOW)["vehicles"][0]

    assert (row["used_litres"], row["remaining_litres"]) == ("15.00", "85.00")


# --- DRIVER --------------------------------------------------------------------------------------------------


def test_driver_sees_vehicle_quota_open_pin_and_duty_due(api):
    unit = UnitFactory()
    vehicle = VehicleFactory(unit=unit, registration_number="AP39AA0001", make="Mahindra", model="Bolero",
                             fuel_type=FuelType.DIESEL, monthly_fuel_limit_litres=Decimal("100"))
    driver = driver_on(vehicle)
    FuelGrantFactory(vehicle=vehicle, litres=Decimal("30"))
    fill = filled_request(vehicle, Decimal("45"), ago(minutes=5), driver=driver)
    filled_request(vehicle, Decimal("5"), ago(minutes=9))  # another driver's fill: not in this duty list
    opened = FuelRequestFactory(vehicle=vehicle, driver=driver, pin="123456", litres_requested=Decimal("20"))

    body = dashboard(driver, api)

    assert set(body) == {"role", "month", "vehicle", "quota", "open_request", "duty_due", "odometer"}
    assert body["vehicle"] == {
        "id": vehicle.id,
        "registration_number": "AP39AA0001",
        "make": "Mahindra",
        "model": "Bolero",
        "fuel_type": "DIESEL",
    }
    assert body["quota"] == {
        "limit_litres": "130.00",
        "used_litres": "50.00",
        "remaining_litres": "80.00",
        "emergency_remaining_litres": "10.00",
    }
    assert body["open_request"] == {
        "id": opened.id,
        "pin": "123456",
        "litres_requested": "20.00",
        "expires_at": iso(opened.expires_at),
    }
    assert body["duty_due"] == [
        {
            "id": fill.id,
            "registration_number": "AP39AA0001",
            "filled_at": iso(fill.filled_at),
            "litres_filled": "45.00",
            "duty_due_at": iso(fill.filled_at + timedelta(hours=48)),
            "duty_overdue": False,
        }
    ]
    assert body["odometer"] == {"week_of": week_of(today_ist()).isoformat(), "recorded": False, "reading_km": None}


def test_driver_who_has_entered_this_weeks_odometer_reading(api):
    vehicle = VehicleFactory()
    driver = driver_on(vehicle)
    last_week = week_of(today_ist()) - timedelta(weeks=1)
    OdometerReadingFactory(vehicle=vehicle, week_of=last_week, reading_km=1100)
    OdometerReadingFactory(vehicle=vehicle, reading_km=1200)

    body = dashboard(driver, api)

    assert body["odometer"] == {"week_of": week_of(today_ist()).isoformat(), "recorded": True, "reading_km": 1200}


def test_driver_odometer_is_for_the_most_recent_sunday():
    vehicle = VehicleFactory()
    driver = driver_on(vehicle)
    OdometerReadingFactory(vehicle=vehicle, week_of=date(2026, 10, 4), reading_km=1100)

    assert summaries.driver_summary(driver, NOW)["odometer"] == {
        "week_of": "2026-10-11", "recorded": False, "reading_km": None,
    }
    assert summaries.driver_summary(driver, ist(10, 10))["odometer"] == {
        "week_of": "2026-10-04", "recorded": True, "reading_km": 1100,
    }
    assert summaries.driver_summary(driver, ist(10, 11, 8))["odometer"]["week_of"] == "2026-10-11"  # a Sunday


def test_driver_without_a_vehicle_gets_empty_cards(api):
    body = dashboard(DriverFactory(), api)

    assert body["vehicle"] is None
    assert body["quota"] is None
    assert body["open_request"] is None
    assert body["duty_due"] == []
    assert body["odometer"] == {"week_of": week_of(today_ist()).isoformat(), "recorded": False, "reading_km": None}


@pytest.mark.parametrize(
    "overrides",
    [
        {"status": RequestStatus.CANCELLED},
        {"status": RequestStatus.EXPIRED},
        {"expires_at": NOW},  # still marked open, but the PIN ran out
    ],
)
def test_driver_has_no_open_request_once_the_pin_cannot_be_used(overrides):
    vehicle = VehicleFactory()
    driver = driver_on(vehicle)
    FuelRequestFactory(vehicle=vehicle, driver=driver, **overrides)

    assert summaries.driver_summary(driver, NOW + timedelta(hours=1))["open_request"] is None


def test_driver_quota_shows_what_is_left_of_the_emergency_litres():
    vehicle = VehicleFactory(monthly_fuel_limit_litres=Decimal("100"))
    driver = driver_on(vehicle)
    filled_request(vehicle, Decimal("104"), ist(10, 3), driver=driver, emergency_litres=Decimal("4"))

    quota = summaries.driver_summary(driver, NOW)["quota"]

    assert quota == {
        "limit_litres": "100.00",
        "used_litres": "104.00",
        "remaining_litres": "-4.00",
        "emergency_remaining_litres": "6.00",
    }


# --- PUMP OPERATOR -------------------------------------------------------------------------------------------


def test_police_pump_operator_sees_stock_and_todays_fills(api):
    unit = UnitFactory()
    pump = stocked(unit, "Alpha Pump", "500", "40")
    pump.tanks.filter(fuel_type=FuelType.PETROL).update(capacity_litres=Decimal("2000"))
    operator = PumpStaffFactory(pump=pump, unit=unit)
    petrol_jeep = VehicleFactory(unit=unit, fuel_type=FuelType.PETROL)
    diesel_jeep = VehicleFactory(unit=unit, fuel_type=FuelType.DIESEL)
    filled_request(petrol_jeep, Decimal("10"), timezone.now(), pump=pump)
    filled_request(diesel_jeep, Decimal("15.5"), timezone.now(), pump=pump)
    filled_request(diesel_jeep, Decimal("99"), timezone.now(), pump=PumpFactory(unit=unit))  # another pump

    body = dashboard(operator, api)

    assert set(body) == {"role", "month", "pump", "tanks", "waiting", "today_fills", "month_fills"}
    assert body["pump"] == {"id": pump.id, "name": "Alpha Pump", "kind": "POLICE"}
    assert [(tank["fuel_type"], tank["current_stock_litres"], tank["is_low"]) for tank in body["tanks"]] == [
        ("PETROL", "500.00", False),
        ("DIESEL", "40.00", True),
    ]
    assert set(body["tanks"][0]) == {
        "id", "pump_name", "fuel_type", "current_stock_litres", "low_stock_threshold_litres", "capacity_litres",
        "is_low",
    }
    assert [tank["capacity_litres"] for tank in body["tanks"]] == ["2000.00", None]
    assert body["today_fills"] == {"count": 2, "litres": "25.50"}
    assert body["month_fills"] == {"petrol_litres": "10.00", "diesel_litres": "15.50"}


def test_tie_up_operator_sees_no_tanks_and_how_many_vehicles_are_waiting(api):
    unit = UnitFactory()
    bunk = tieup_pump(unit)
    operator = PumpStaffFactory(pump=bunk, unit=unit)
    for _ in range(2):
        FuelRequestFactory(vehicle=VehicleFactory(unit=unit), pump=bunk)
    FuelRequestFactory(vehicle=VehicleFactory(unit=unit), pump=bunk, expires_at=timezone.now() - timedelta(minutes=1))
    FuelRequestFactory(vehicle=VehicleFactory(unit=unit), pump=tieup_pump(unit))  # another bunk's

    body = dashboard(operator, api)

    assert body["pump"] == {"id": bunk.id, "name": bunk.name, "kind": "TIE_UP"}
    assert body["tanks"] == []
    assert body["waiting"] == 2  # the request whose PIN ran out is not waiting any more
    assert body["today_fills"] == {"count": 0, "litres": "0.00"}
    assert body["month_fills"] == {"petrol_litres": "0.00", "diesel_litres": "0.00"}


def test_pump_fills_count_from_midnight_in_kolkata_and_the_month_from_the_first():
    unit = UnitFactory()
    pump = PumpFactory(unit=unit)
    operator = PumpStaffFactory(pump=pump, unit=unit)
    petrol_jeep = VehicleFactory(unit=unit, fuel_type=FuelType.PETROL)
    diesel_jeep = VehicleFactory(unit=unit, fuel_type=FuelType.DIESEL)
    filled_request(petrol_jeep, Decimal("1"), datetime(2026, 10, 15, 0, 0, tzinfo=IST), pump=pump)  # midnight: today
    filled_request(petrol_jeep, Decimal("2"), datetime(2026, 10, 15, 23, 59, tzinfo=IST), pump=pump)
    filled_request(diesel_jeep, Decimal("4"), datetime(2026, 10, 14, 23, 59, tzinfo=IST), pump=pump)  # yesterday
    filled_request(diesel_jeep, Decimal("32"), datetime(2026, 10, 16, 0, 0, tzinfo=IST), pump=pump)  # tomorrow
    filled_request(diesel_jeep, Decimal("8"), datetime(2026, 10, 1, 0, 0, tzinfo=IST), pump=pump)
    filled_request(diesel_jeep, Decimal("16"), datetime(2026, 9, 30, 23, 59, tzinfo=IST), pump=pump)  # last month

    body = summaries.pump_summary(operator, NOW)

    assert body["today_fills"] == {"count": 2, "litres": "3.00"}
    assert body["month_fills"] == {"petrol_litres": "3.00", "diesel_litres": "44.00"}


def test_pump_fills_that_were_not_filled_do_not_count():
    unit = UnitFactory()
    pump = PumpFactory(unit=unit)
    operator = PumpStaffFactory(pump=pump, unit=unit)
    vehicle = VehicleFactory(unit=unit)
    FuelRequestFactory(vehicle=vehicle, pump=pump, filled_at=NOW, litres_filled=Decimal("9"))  # still open

    body = summaries.pump_summary(operator, NOW)

    assert body["today_fills"] == {"count": 0, "litres": "0.00"}
    assert body["month_fills"] == {"petrol_litres": "0.00", "diesel_litres": "0.00"}
