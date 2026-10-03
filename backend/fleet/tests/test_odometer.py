from datetime import date, timedelta

import pytest

from common.exceptions import BusinessRuleError
from common.months import today_ist
from fleet import services
from fleet.odometer import latest_odometer_km, record_reading, week_of
from testing.factories import (
    DriverFactory,
    OdometerReadingFactory,
    ServiceRecordFactory,
    VehicleFactory,
    driver_on,
    unit_mto,
)

pytestmark = pytest.mark.django_db

SUNDAY = date(2026, 10, 4)
MONDAY = date(2026, 10, 5)
SATURDAY = date(2026, 10, 10)
NEXT_SUNDAY = date(2026, 10, 11)


@pytest.fixture
def vehicle():
    return VehicleFactory(odometer_at_onboarding_km=10000)


@pytest.fixture
def driver(vehicle):
    return driver_on(vehicle)


def refusal(driver, reading_km, today):
    with pytest.raises(BusinessRuleError) as error:
        record_reading(driver, reading_km, today=today)
    return str(error.value.detail)


# --- week_of ------------------------------------------------------------------------------------


def test_week_of_a_sunday_is_that_sunday():
    assert week_of(SUNDAY) == SUNDAY


def test_week_of_a_monday_is_the_sunday_before():
    assert week_of(MONDAY) == SUNDAY


def test_week_of_a_saturday_is_the_sunday_six_days_before():
    assert week_of(SATURDAY) == SUNDAY


def test_the_next_sunday_starts_a_new_week():
    assert week_of(NEXT_SUNDAY) == NEXT_SUNDAY


# --- latest_odometer_km -------------------------------------------------------------------------


def test_latest_odometer_is_the_onboarding_reading_when_nothing_else_is_recorded(vehicle):
    assert latest_odometer_km(vehicle) == 10000


def test_latest_odometer_is_the_largest_of_onboarding_newest_reading_and_newest_service(vehicle, driver):
    OdometerReadingFactory(vehicle=vehicle, recorded_by=driver, week_of=SUNDAY, reading_km=12000)
    assert latest_odometer_km(vehicle) == 12000

    ServiceRecordFactory(vehicle=vehicle, service_date=MONDAY, odometer_km=13000)
    assert latest_odometer_km(vehicle) == 13000

    OdometerReadingFactory(vehicle=vehicle, recorded_by=driver, week_of=NEXT_SUNDAY, reading_km=13500)
    assert latest_odometer_km(vehicle) == 13500


def test_latest_odometer_ignores_other_vehicles(vehicle):
    OdometerReadingFactory(reading_km=99999)
    assert latest_odometer_km(vehicle) == 10000


# --- record_reading -----------------------------------------------------------------------------


def test_a_reading_is_recorded_for_the_most_recent_sunday(vehicle, driver):
    reading = record_reading(driver, 10450, today=MONDAY)

    reading.refresh_from_db()
    assert reading.vehicle == vehicle
    assert reading.week_of == SUNDAY
    assert reading.reading_km == 10450
    assert reading.recorded_by == driver


def test_the_date_defaults_to_today_in_asia_kolkata(vehicle, driver):
    reading = record_reading(driver, 10450)

    assert reading.week_of == week_of(today_ist())


def test_a_reading_equal_to_the_last_one_is_accepted(vehicle, driver):
    record_reading(driver, 10500, today=SUNDAY)

    assert record_reading(driver, 10500, today=NEXT_SUNDAY).reading_km == 10500


def test_a_second_reading_in_the_same_week_is_refused(vehicle, driver):
    record_reading(driver, 10450, today=SUNDAY)

    assert refusal(driver, 10600, today=SATURDAY) == "This week's reading is already recorded."
    assert vehicle.odometer_readings.count() == 1


def test_a_reading_lower_than_the_last_one_is_refused_with_the_number(vehicle, driver):
    record_reading(driver, 12000, today=SUNDAY)

    assert refusal(driver, 11999, today=NEXT_SUNDAY) == "The reading can't be lower than the last reading (12000 km)."
    assert vehicle.odometer_readings.count() == 1


def test_a_reading_lower_than_the_onboarding_odometer_is_refused(vehicle, driver):
    assert refusal(driver, 9000, today=SUNDAY) == "The reading can't be lower than the last reading (10000 km)."


def test_a_reading_lower_than_the_last_service_odometer_is_refused(vehicle, driver):
    ServiceRecordFactory(vehicle=vehicle, service_date=SUNDAY, odometer_km=13000)

    assert refusal(driver, 12500, today=NEXT_SUNDAY) == "The reading can't be lower than the last reading (13000 km)."


def test_a_driver_without_a_vehicle_is_refused():
    assert refusal(DriverFactory(), 5000, today=SUNDAY) == "You are not linked to a vehicle. Contact your MTO."


def test_a_driver_whose_link_ended_is_refused(vehicle, driver):
    link = vehicle.assignments.get(person=driver)
    services.end_assignment(link, ended_by=unit_mto(vehicle.unit))

    assert refusal(driver, 10500, today=SUNDAY) == "You are not linked to a vehicle. Contact your MTO."
    assert vehicle.odometer_readings.count() == 0


def test_the_next_week_accepts_a_new_reading(vehicle, driver):
    record_reading(driver, 10450, today=SUNDAY)

    second = record_reading(driver, 10900, today=NEXT_SUNDAY + timedelta(days=1))

    assert second.week_of == NEXT_SUNDAY
    assert [r.reading_km for r in vehicle.odometer_readings.all()] == [10900, 10450]  # newest week first
