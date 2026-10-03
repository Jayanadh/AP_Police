from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from common.months import IST
from fuel import jobs, requests
from fuel.models import FuelRequest, RequestStatus
from notifications.models import Notification
from testing.factories import FuelRequestFactory, MTOFactory, VehicleFactory, driver_on, filled_request

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 10, 5, 10, 0, tzinfo=IST)
FILLED_AT = datetime(2026, 10, 3, 9, 0, tzinfo=IST)  # 49 hours before NOW


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def vehicle(mto):
    return VehicleFactory(unit=mto.unit, registration_number="AP39PA1234")


@pytest.fixture
def driver(vehicle):
    return driver_on(vehicle)


def alerts_for(user):
    return list(Notification.objects.filter(recipient=user))


# --- expiring PINs -----------------------------------------------------------------------------


def test_an_old_issued_request_is_expired(vehicle):
    old = FuelRequestFactory(vehicle=vehicle, expires_at=NOW - timedelta(minutes=1))
    fresh = FuelRequestFactory(vehicle=VehicleFactory(), expires_at=NOW + timedelta(minutes=1))

    assert jobs.expire_unused_pins(NOW) == 1

    old.refresh_from_db()
    fresh.refresh_from_db()
    assert old.status == RequestStatus.EXPIRED
    assert fresh.status == RequestStatus.ISSUED
    assert jobs.expire_unused_pins(NOW) == 0


# --- overdue duty particulars ------------------------------------------------------------------


def test_the_driver_and_mto_are_alerted_once_when_duty_particulars_are_48_hours_late(vehicle, driver, mto):
    request = filled_request(vehicle, Decimal("12.5"), FILLED_AT, driver=driver)

    assert jobs.remind_overdue_duty(NOW - timedelta(hours=2)) == 0  # 47 hours after the fill
    assert Notification.objects.count() == 0

    assert jobs.remind_overdue_duty(NOW) == 1  # 49 hours after the fill

    [to_driver] = alerts_for(driver)
    assert to_driver.title == "Duty particulars overdue"
    assert to_driver.body == "AP39PA1234, 12.50 L on 2026-10-03."
    assert to_driver.link == "/driver/fuel"
    [to_mto] = alerts_for(mto)
    assert to_mto.title == "Duty particulars overdue: AP39PA1234"
    assert to_mto.link == "/mto/fuel"
    request.refresh_from_db()
    assert request.duty_overdue_notified is True

    assert jobs.remind_overdue_duty(NOW) == 0
    assert jobs.remind_overdue_duty(NOW + timedelta(days=3)) == 0
    assert Notification.objects.count() == 2


def test_duty_particulars_are_overdue_from_exactly_48_hours(vehicle, driver):
    filled_request(vehicle, Decimal("5"), NOW - timedelta(hours=48), driver=driver)

    assert jobs.remind_overdue_duty(NOW - timedelta(seconds=1)) == 0
    assert jobs.remind_overdue_duty(NOW) == 1


def test_the_alert_goes_to_exactly_the_requests_the_overdue_rule_picks_out(vehicle, driver):
    almost = filled_request(vehicle, Decimal("5"), NOW - timedelta(hours=47, minutes=59), driver=driver)
    exactly = filled_request(vehicle, Decimal("6"), NOW - timedelta(hours=48), driver=driver)
    late = filled_request(vehicle, Decimal("7"), NOW - timedelta(hours=48, minutes=1), driver=driver)
    overdue = set(requests.overdue_duty(NOW))
    assert overdue == {exactly, late}

    assert jobs.remind_overdue_duty(NOW) == 2

    assert set(FuelRequest.objects.filter(duty_overdue_notified=True)) == overdue
    almost.refresh_from_db()
    assert almost.duty_overdue_notified is False


def test_the_date_in_the_alert_is_the_filling_day_in_india(vehicle, driver):
    after_midnight = datetime(2026, 10, 4, 0, 30, tzinfo=IST)  # still 3 October in UTC
    filled_request(vehicle, Decimal("5"), after_midnight, driver=driver)

    jobs.remind_overdue_duty(NOW + timedelta(days=1))

    assert alerts_for(driver)[0].body == "AP39PA1234, 5.00 L on 2026-10-04."


def test_requests_with_duty_particulars_or_not_filled_are_not_alerted(vehicle, driver, mto):
    submitted = filled_request(
        vehicle, Decimal("5"), FILLED_AT, driver=driver, duty_particulars="Escort duty", duty_submitted_at=NOW
    )
    open_request = FuelRequestFactory(vehicle=VehicleFactory(unit=mto.unit))
    cancelled = FuelRequestFactory(vehicle=VehicleFactory(unit=mto.unit), status=RequestStatus.CANCELLED)

    assert jobs.remind_overdue_duty(NOW) == 0

    assert Notification.objects.count() == 0
    for request in (submitted, open_request, cancelled):
        request.refresh_from_db()
        assert request.duty_overdue_notified is False


def test_each_overdue_request_is_alerted_separately(mto):
    first = filled_request(VehicleFactory(unit=mto.unit, registration_number="AP39AA0001"), Decimal("5"), FILLED_AT)
    second = filled_request(VehicleFactory(unit=mto.unit, registration_number="AP39AA0002"), Decimal("6"), FILLED_AT)

    assert jobs.remind_overdue_duty(NOW) == 2

    assert Notification.objects.filter(recipient=first.driver).count() == 1
    assert Notification.objects.filter(recipient=second.driver).count() == 1
    mto_titles = sorted(Notification.objects.filter(recipient=mto).values_list("title", flat=True))
    assert mto_titles == ["Duty particulars overdue: AP39AA0001", "Duty particulars overdue: AP39AA0002"]
