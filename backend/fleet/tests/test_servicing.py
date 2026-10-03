from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from common.exceptions import BusinessRuleError
from common.months import IST, today_ist
from fleet.models import ServiceRecord, Vehicle
from fleet.servicing import record_service, service_status
from testing.factories import MTOFactory, OdometerReadingFactory, ServiceRecordFactory, VehicleFactory

pytestmark = pytest.mark.django_db

TODAY = date(2026, 10, 5)


@pytest.fixture
def vehicle():
    return VehicleFactory(odometer_at_onboarding_km=10000, service_interval_km=5000)


def reading(vehicle, km):
    """The next Sunday reading of the vehicle, counting weekly from the first Sunday of 2026."""
    week = date(2026, 1, 4) + timedelta(weeks=vehicle.odometer_readings.count())
    OdometerReadingFactory(vehicle=vehicle, week_of=week, reading_km=km)


# --- due by distance ----------------------------------------------------------------------------


def test_due_when_the_interval_in_km_has_been_driven_since_onboarding(vehicle):
    reading(vehicle, 15000)

    status = service_status(vehicle, TODAY)

    assert status["due"] is True
    assert status["km_since"] == 5000
    assert status["last_service_km"] == 10000
    assert status["next_due_km"] == 15000


def test_not_due_one_km_short_of_the_interval(vehicle):
    reading(vehicle, 14999)

    status = service_status(vehicle, TODAY)

    assert status["due"] is False
    assert status["km_since"] == 4999


def test_the_distance_counts_from_the_last_service_odometer(vehicle):
    ServiceRecordFactory(vehicle=vehicle, service_date=TODAY - timedelta(days=10), odometer_km=15000)
    reading(vehicle, 19999)

    status = service_status(vehicle, TODAY)

    assert status["due"] is False
    assert status["last_service_km"] == 15000
    assert status["km_since"] == 4999
    assert status["next_due_km"] == 20000

    reading(vehicle, 20000)
    assert service_status(vehicle, TODAY)["due"] is True


# --- due by time --------------------------------------------------------------------------------


def test_due_when_the_interval_in_days_has_passed_since_the_last_service():
    vehicle = VehicleFactory(service_interval_days=90)
    ServiceRecordFactory(vehicle=vehicle, service_date=TODAY - timedelta(days=91), odometer_km=0)

    status = service_status(vehicle, TODAY)

    assert status["due"] is True
    assert status["days_since"] == 91
    assert status["last_service_date"] == TODAY - timedelta(days=91)
    assert status["next_due_date"] == TODAY - timedelta(days=1)


def test_due_exactly_on_the_last_day_of_the_interval_but_not_a_day_before():
    vehicle = VehicleFactory(service_interval_days=90)
    ServiceRecordFactory(vehicle=vehicle, service_date=TODAY - timedelta(days=90), odometer_km=0)

    assert service_status(vehicle, TODAY)["due"] is True
    assert service_status(vehicle, TODAY - timedelta(days=1))["due"] is False


def test_due_by_whichever_interval_comes_first():
    vehicle = VehicleFactory(odometer_at_onboarding_km=0, service_interval_km=5000, service_interval_days=90)
    ServiceRecordFactory(vehicle=vehicle, service_date=TODAY - timedelta(days=30), odometer_km=1000)
    reading(vehicle, 6000)

    assert service_status(vehicle, TODAY)["due"] is True  # the km interval, though only 30 days have passed

    other = VehicleFactory(odometer_at_onboarding_km=0, service_interval_km=5000, service_interval_days=90)
    ServiceRecordFactory(vehicle=other, service_date=TODAY - timedelta(days=95), odometer_km=1000)
    reading(other, 2000)

    assert service_status(other, TODAY)["due"] is True  # the day interval, though only 1000 km were driven


# --- no service yet and no interval -------------------------------------------------------------


def test_without_a_service_the_count_starts_at_the_vehicle_creation_date_and_onboarding_odometer():
    vehicle = VehicleFactory(odometer_at_onboarding_km=8000, service_interval_days=90)
    created = date(2026, 6, 1)
    Vehicle.objects.filter(pk=vehicle.pk).update(created_at=datetime(2026, 6, 1, 10, 0, tzinfo=IST))

    status = service_status(Vehicle.objects.get(pk=vehicle.pk), TODAY)

    assert status["last_service_date"] == created
    assert status["last_service_km"] == 8000
    assert status["days_since"] == (TODAY - created).days == 126
    assert status["due"] is True
    assert status["next_due_date"] == created + timedelta(days=90)
    assert status["next_due_km"] is None


def test_the_creation_date_is_the_asia_kolkata_date():
    vehicle = VehicleFactory(service_interval_days=1)
    # 20:00 UTC on 1 June is already 01:30 on 2 June in Kolkata.
    Vehicle.objects.filter(pk=vehicle.pk).update(created_at=datetime(2026, 6, 1, 20, 0, tzinfo=ZoneInfo("UTC")))

    status = service_status(Vehicle.objects.get(pk=vehicle.pk), TODAY)

    assert status["last_service_date"] == date(2026, 6, 2)


def test_no_interval_means_never_due():
    vehicle = VehicleFactory(odometer_at_onboarding_km=0)
    ServiceRecordFactory(vehicle=vehicle, service_date=TODAY - timedelta(days=4000), odometer_km=0)
    reading(vehicle, 900000)

    status = service_status(vehicle, TODAY)

    assert status["due"] is False
    assert status["next_due_km"] is None
    assert status["next_due_date"] is None
    assert status["km_since"] == 900000
    assert status["days_since"] == 4000


def test_the_newest_service_record_is_the_one_that_counts(vehicle):
    ServiceRecordFactory(vehicle=vehicle, service_date=TODAY - timedelta(days=200), odometer_km=11000)
    ServiceRecordFactory(vehicle=vehicle, service_date=TODAY - timedelta(days=20), odometer_km=14000)

    status = service_status(vehicle, TODAY)

    assert status["last_service_date"] == TODAY - timedelta(days=20)
    assert status["last_service_km"] == 14000
    assert status["next_due_km"] == 19000


# --- record_service -----------------------------------------------------------------------------


def test_a_service_is_recorded_with_its_details(vehicle):
    mto = MTOFactory(unit=vehicle.unit)

    record = record_service(vehicle, date(2026, 10, 1), 15200, "Oil and filters changed.", by=mto)

    record.refresh_from_db()
    assert record.vehicle == vehicle
    assert record.service_date == date(2026, 10, 1)
    assert record.odometer_km == 15200
    assert record.notes == "Oil and filters changed."
    assert record.recorded_by == mto


def test_recording_a_service_resets_the_alert_flag_and_the_vehicle_is_no_longer_due(vehicle):
    reading(vehicle, 15000)
    Vehicle.objects.filter(pk=vehicle.pk).update(service_due_alerted=True)
    vehicle.refresh_from_db()
    assert service_status(vehicle, TODAY)["due"] is True

    record_service(vehicle, TODAY, 15000, "", by=MTOFactory(unit=vehicle.unit), today=TODAY)

    vehicle.refresh_from_db()
    assert vehicle.service_due_alerted is False
    status = service_status(vehicle, TODAY)
    assert status["due"] is False
    assert status["km_since"] == 0
    assert status["next_due_km"] == 20000


def test_a_service_done_today_is_accepted(vehicle):
    today = today_ist()

    record = record_service(vehicle, today, 12000, "", by=MTOFactory(unit=vehicle.unit))

    assert record.service_date == today


def test_a_service_date_in_the_future_is_refused(vehicle):
    with pytest.raises(BusinessRuleError) as error:
        record_service(vehicle, TODAY + timedelta(days=1), 12000, "", by=MTOFactory(unit=vehicle.unit), today=TODAY)

    assert str(error.value.detail) == "The service date can't be in the future."
    assert ServiceRecord.objects.count() == 0
