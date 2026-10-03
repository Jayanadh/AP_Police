from datetime import date, datetime, timedelta, timezone

import pytest

from common.months import IST
from fleet import jobs
from fleet.models import Vehicle, VehicleStatus
from fleet.servicing import record_service
from notifications.models import Notification
from testing.factories import MTOFactory, OdometerReadingFactory, VehicleFactory, driver_on, unit_mto

pytestmark = pytest.mark.django_db

SUNDAY = datetime(2026, 10, 4, 12, 0, tzinfo=IST)
MONDAY = datetime(2026, 10, 5, 10, 0, tzinfo=IST)
SATURDAY = datetime(2026, 10, 10, 18, 0, tzinfo=IST)
NEXT_MONDAY = datetime(2026, 10, 12, 10, 0, tzinfo=IST)
LAST_SUNDAY = date(2026, 10, 4)


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def vehicle(mto):
    return VehicleFactory(unit=mto.unit, registration_number="AP39PA1234")


def alerts_for(user):
    return list(Notification.objects.filter(recipient=user))


# --- missing odometer readings -----------------------------------------------------------------


def test_nothing_is_sent_on_a_sunday(vehicle):
    driver_on(vehicle)

    assert jobs.alert_missing_odometer(SUNDAY) == 0

    assert Notification.objects.count() == 0
    vehicle.refresh_from_db()
    assert vehicle.odometer_alert_week is None


def test_the_day_is_the_one_in_india_not_in_utc(vehicle):
    driver_on(vehicle)
    sunday_morning_in_india = datetime(2026, 10, 3, 20, 0, tzinfo=timezone.utc)  # 01:30 on Sunday in India
    monday_morning_in_india = datetime(2026, 10, 4, 20, 0, tzinfo=timezone.utc)  # 01:30 on Monday in India

    assert jobs.alert_missing_odometer(sunday_morning_in_india) == 0
    assert jobs.alert_missing_odometer(monday_morning_in_india) == 1


def test_the_driver_and_mto_are_alerted_on_monday_when_there_is_no_reading(vehicle, mto):
    driver = driver_on(vehicle)

    assert jobs.alert_missing_odometer(MONDAY) == 1

    [to_driver] = alerts_for(driver)
    assert to_driver.title == "Odometer reading missing"
    assert to_driver.body == "Enter the reading for AP39PA1234 for the week of 2026-10-04."
    assert to_driver.link == "/driver/odometer"
    [to_mto] = alerts_for(mto)
    assert to_mto.title == "Odometer reading missing: AP39PA1234"
    assert to_mto.body == "No reading yet for the week of 2026-10-04."
    assert to_mto.link == "/mto/odometer"
    vehicle.refresh_from_db()
    assert vehicle.odometer_alert_week == LAST_SUNDAY


def test_a_second_run_in_the_same_week_sends_nothing(vehicle):
    driver_on(vehicle)
    jobs.alert_missing_odometer(MONDAY)

    assert jobs.alert_missing_odometer(MONDAY) == 0
    assert jobs.alert_missing_odometer(SATURDAY) == 0

    assert Notification.objects.count() == 2


def test_the_next_week_alerts_again(vehicle):
    driver_on(vehicle)
    jobs.alert_missing_odometer(MONDAY)

    assert jobs.alert_missing_odometer(NEXT_MONDAY) == 1

    vehicle.refresh_from_db()
    assert vehicle.odometer_alert_week == date(2026, 10, 11)
    assert Notification.objects.count() == 4


def test_a_vehicle_with_the_reading_is_not_alerted(vehicle):
    driver_on(vehicle)
    OdometerReadingFactory(vehicle=vehicle, week_of=LAST_SUNDAY)

    assert jobs.alert_missing_odometer(MONDAY) == 0

    assert Notification.objects.count() == 0


def test_an_older_reading_does_not_count(vehicle):
    driver_on(vehicle)
    OdometerReadingFactory(vehicle=vehicle, week_of=LAST_SUNDAY - timedelta(weeks=1))

    assert jobs.alert_missing_odometer(MONDAY) == 1


def test_a_vehicle_without_a_driver_is_not_alerted(vehicle):
    driver = driver_on(vehicle)
    link = driver.vehicle_assignments.get()
    link.ended_at = MONDAY
    link.save(update_fields=["ended_at"])
    VehicleFactory(unit=vehicle.unit)  # never had a driver

    assert jobs.alert_missing_odometer(MONDAY) == 0

    assert Notification.objects.count() == 0


@pytest.mark.parametrize("status", [VehicleStatus.PAUSED, VehicleStatus.TERMINATION_PENDING, VehicleStatus.TERMINATED])
def test_only_active_vehicles_are_alerted(vehicle, status):
    driver_on(vehicle)
    Vehicle.objects.filter(pk=vehicle.pk).update(status=status)

    assert jobs.alert_missing_odometer(MONDAY) == 0

    assert Notification.objects.count() == 0


def test_every_office_is_alerted_about_its_own_vehicles(vehicle, mto):
    driver = driver_on(vehicle)
    other = VehicleFactory(registration_number="AP39ZZ0002")
    other_driver = driver_on(other)

    assert jobs.alert_missing_odometer(MONDAY) == 2

    assert [alert.title for alert in alerts_for(driver)] == ["Odometer reading missing"]
    assert [alert.title for alert in alerts_for(other_driver)] == ["Odometer reading missing"]
    assert [alert.title for alert in alerts_for(mto)] == ["Odometer reading missing: AP39PA1234"]
    assert [alert.title for alert in alerts_for(unit_mto(other.unit))] == ["Odometer reading missing: AP39ZZ0002"]


# --- service due -------------------------------------------------------------------------------


@pytest.fixture
def due_vehicle(mto):
    """Onboarded at 10000 km with a 5000 km interval, and now at 15000 km: due."""
    vehicle = VehicleFactory(
        unit=mto.unit, registration_number="AP39PA1234", odometer_at_onboarding_km=10000, service_interval_km=5000
    )
    OdometerReadingFactory(vehicle=vehicle, week_of=date(2026, 9, 27), reading_km=15000)
    return vehicle


def test_the_mto_is_alerted_once_when_a_service_falls_due(due_vehicle, mto):
    assert jobs.alert_service_due(MONDAY) == 1

    [alert] = alerts_for(mto)
    assert alert.title == "Service due: AP39PA1234"
    assert alert.link == f"/mto/vehicles/{due_vehicle.pk}"
    due_vehicle.refresh_from_db()
    assert due_vehicle.service_due_alerted is True

    assert jobs.alert_service_due(MONDAY) == 0
    assert jobs.alert_service_due(NEXT_MONDAY) == 0
    assert Notification.objects.count() == 1


def test_a_service_starts_a_new_cycle_that_can_alert_again(due_vehicle, mto):
    jobs.alert_service_due(MONDAY)

    record_service(due_vehicle, date(2026, 10, 5), 15000, "Oil change", mto, today=date(2026, 10, 5))
    assert jobs.alert_service_due(MONDAY) == 0  # serviced: not due any more

    OdometerReadingFactory(vehicle=due_vehicle, week_of=date(2026, 10, 11), reading_km=20000)
    assert jobs.alert_service_due(NEXT_MONDAY) == 1  # due again, after the flag was reset

    assert [alert.title for alert in alerts_for(mto)] == ["Service due: AP39PA1234"] * 2


def test_a_vehicle_that_is_not_due_is_not_alerted(mto):
    vehicle = VehicleFactory(unit=mto.unit, odometer_at_onboarding_km=10000, service_interval_km=5000)
    OdometerReadingFactory(vehicle=vehicle, week_of=date(2026, 9, 27), reading_km=14999)
    VehicleFactory(unit=mto.unit)  # no service interval: never due

    assert jobs.alert_service_due(MONDAY) == 0

    assert Notification.objects.count() == 0


def test_a_service_is_due_after_the_interval_in_days(mto):
    vehicle = VehicleFactory(unit=mto.unit, service_interval_days=90)
    Vehicle.objects.filter(pk=vehicle.pk).update(created_at=datetime(2026, 7, 1, tzinfo=IST))

    assert jobs.alert_service_due(datetime(2026, 9, 28, 10, 0, tzinfo=IST)) == 0  # 89 days
    assert jobs.alert_service_due(datetime(2026, 9, 29, 10, 0, tzinfo=IST)) == 1  # 90 days


@pytest.mark.parametrize("status", [VehicleStatus.ACTIVE, VehicleStatus.PAUSED])
def test_active_and_paused_vehicles_are_alerted(due_vehicle, status):
    Vehicle.objects.filter(pk=due_vehicle.pk).update(status=status)

    assert jobs.alert_service_due(MONDAY) == 1


@pytest.mark.parametrize("status", [VehicleStatus.TERMINATION_PENDING, VehicleStatus.TERMINATED])
def test_vehicles_leaving_the_fleet_are_not_alerted(due_vehicle, status):
    Vehicle.objects.filter(pk=due_vehicle.pk).update(status=status)

    assert jobs.alert_service_due(MONDAY) == 0

    assert Notification.objects.count() == 0
