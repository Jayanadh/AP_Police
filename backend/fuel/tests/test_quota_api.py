from datetime import datetime
from decimal import Decimal

import pytest

from common.months import IST, current_month, format_month, month_bounds
from fleet import services
from fleet.models import VehicleStatus
from testing.factories import (
    DriverFactory,
    FuelGrantFactory,
    MTOFactory,
    OfficerFactory,
    PTOFactory,
    PumpStaffFactory,
    UnitFactory,
    VehicleFactory,
    filled_request,
)

pytestmark = pytest.mark.django_db

MONTH = "2026-09"
MONTH_START = datetime(2026, 9, 1, tzinfo=IST)


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def vehicle(mto):
    return VehicleFactory(unit=mto.unit, monthly_fuel_limit_litres=Decimal("100"))


@pytest.fixture
def driver(mto, vehicle):
    person = DriverFactory(unit=mto.unit)
    services.assign_person(vehicle, person, mto)
    return person


def quota_url(vehicle, month=MONTH):
    return f"/api/fuel/vehicles/{vehicle.id}/quota/" + (f"?month={month}" if month is not None else "")


def fill_the_month(vehicle):
    """A 30 L grant, then fills of 50 and 70 L (limit 100)."""
    FuelGrantFactory(vehicle=vehicle, month=MONTH_START.date(), litres=Decimal("30"))
    filled_request(vehicle, Decimal("50"), datetime(2026, 9, 3, 10, tzinfo=IST))
    filled_request(vehicle, Decimal("70"), datetime(2026, 9, 9, 10, tzinfo=IST))


def test_the_linked_driver_gets_the_months_numbers(api, vehicle, driver):
    fill_the_month(vehicle)
    api.force_login(driver)

    response = api.get(quota_url(vehicle))

    assert response.status_code == 200
    assert response.json() == {
        "month": "2026-09",
        "base_litres": "100.00",
        "additional_litres": "30.00",
        "limit_litres": "130.00",
        "used_litres": "120.00",
        "remaining_litres": "10.00",
        "emergency_used_litres": "0.00",
        "emergency_remaining_litres": "10.00",
        "additional_balance_litres": "10.00",
    }


def test_an_emergency_fill_shows_negative_remaining_and_balance(api, vehicle, driver):
    fill_the_month(vehicle)
    filled_request(vehicle, Decimal("15"), datetime(2026, 9, 12, 10, tzinfo=IST), emergency_litres=Decimal("5"))
    api.force_login(driver)

    body = api.get(quota_url(vehicle)).json()

    assert body["used_litres"] == "135.00"
    assert body["remaining_litres"] == "-5.00"
    assert body["additional_balance_litres"] == "-5.00"
    assert body["emergency_used_litres"] == "5.00"
    assert body["emergency_remaining_litres"] == "5.00"


def test_the_month_defaults_to_the_current_month(api, vehicle, driver):
    start, _ = month_bounds(current_month())
    filled_request(vehicle, Decimal("25"), start.replace(hour=5))
    filled_request(vehicle, Decimal("60"), datetime(2020, 1, 5, tzinfo=IST))
    api.force_login(driver)

    for url in (quota_url(vehicle, None), quota_url(vehicle, "")):
        body = api.get(url).json()
        assert body["month"] == format_month(current_month())
        assert body["used_litres"] == "25.00"


def test_another_month_is_asked_for_with_the_month_parameter(api, vehicle, driver):
    fill_the_month(vehicle)
    api.force_login(driver)

    body = api.get(quota_url(vehicle, "2026-10")).json()

    assert body["month"] == "2026-10"
    assert (body["additional_litres"], body["used_litres"], body["remaining_litres"]) == (
        "0.00", "0.00", "100.00"
    )


def test_a_badly_formed_month_is_a_400(api, vehicle, driver):
    api.force_login(driver)

    response = api.get(quota_url(vehicle, "2026-13"))

    assert response.status_code == 400
    assert response.json() == {"detail": "Use the month format YYYY-MM."}


def test_a_linked_officer_sees_the_quota(api, mto, vehicle):
    officer = OfficerFactory(unit=mto.unit)
    services.assign_person(vehicle, officer, mto)
    fill_the_month(vehicle)
    api.force_login(officer)

    response = api.get(quota_url(vehicle))

    assert response.status_code == 200
    assert response.json()["remaining_litres"] == "10.00"


def test_the_vehicles_mto_and_any_pto_see_the_quota(api, mto, vehicle):
    fill_the_month(vehicle)
    for user in (mto, PTOFactory()):
        api.force_login(user)
        response = api.get(quota_url(vehicle))
        assert response.status_code == 200, user.role
        assert response.json()["used_litres"] == "120.00"


def test_a_terminated_vehicles_quota_can_still_be_read(api, mto, vehicle):
    fill_the_month(vehicle)
    vehicle.status = VehicleStatus.TERMINATED
    vehicle.save()
    api.force_login(mto)

    assert api.get(quota_url(vehicle)).status_code == 200


def test_an_unlinked_driver_gets_404(api, mto, vehicle, driver):
    unlinked = DriverFactory(unit=mto.unit)
    api.force_login(unlinked)

    assert api.get(quota_url(vehicle)).status_code == 404


def test_an_unlinked_officer_of_the_same_unit_gets_404(api, mto, vehicle):
    api.force_login(OfficerFactory(unit=mto.unit))

    assert api.get(quota_url(vehicle)).status_code == 404


def test_a_driver_whose_link_has_ended_gets_404(api, mto, vehicle):
    former = DriverFactory(unit=mto.unit)
    services.end_assignment(services.assign_person(vehicle, former, mto), mto)
    api.force_login(former)

    assert api.get(quota_url(vehicle)).status_code == 404


def test_another_units_mto_gets_404(api, vehicle):
    api.force_login(MTOFactory())

    assert api.get(quota_url(vehicle)).status_code == 404


def test_a_pump_operator_gets_404(api, mto, vehicle):
    api.force_login(PumpStaffFactory(unit=mto.unit))

    assert api.get(quota_url(vehicle)).status_code == 404


def test_the_drivers_own_vehicle_is_readable_but_another_units_is_not(api, vehicle, driver):
    other = VehicleFactory(unit=UnitFactory())
    api.force_login(driver)

    assert api.get(quota_url(vehicle)).status_code == 200
    assert api.get(quota_url(other)).status_code == 404


def test_an_unknown_vehicle_is_404(api, mto):
    api.force_login(mto)

    assert api.get("/api/fuel/vehicles/999999/quota/").status_code == 404


def test_anonymous_is_refused(api, vehicle):
    assert api.get(quota_url(vehicle)).status_code in (401, 403)


def test_the_quota_is_read_only(api, mto, vehicle):
    api.force_login(mto)

    assert api.post(quota_url(vehicle), {}).status_code == 405
    assert api.patch(quota_url(vehicle), {}).status_code == 405
