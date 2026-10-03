import pytest

from accounts.models import UserStatus
from notifications.models import Notification
from notifications.service import notify, ptos, unit_mtos
from testing.factories import DriverFactory, MTOFactory, PTOFactory, UnitFactory

pytestmark = pytest.mark.django_db


def test_notify_creates_one_row_per_distinct_recipient():
    u, v = DriverFactory(), DriverFactory()
    created = notify([u, u, v], "T", body="B", link="/driver/home")
    assert created == 2
    assert Notification.objects.count() == 2
    row = Notification.objects.get(recipient=u)
    assert (row.title, row.body, row.link, row.read_at) == ("T", "B", "/driver/home", None)


def test_notify_with_no_recipients_creates_nothing():
    assert notify([], "T") == 0
    assert Notification.objects.count() == 0


def test_notify_accepts_a_queryset():
    unit = UnitFactory()
    MTOFactory(unit=unit)
    assert notify(unit_mtos(unit), "T") == 1


def test_unit_mtos_returns_the_units_chair_only():
    unit = UnitFactory()
    chair = MTOFactory(unit=unit)
    MTOFactory()  # another unit's MTO
    DriverFactory(unit=unit)  # same unit, not an MTO
    assert list(unit_mtos(unit)) == [chair]


def test_unit_mtos_is_empty_once_the_chair_is_paused():
    unit = UnitFactory()
    chair = MTOFactory(unit=unit)
    chair.status = UserStatus.PAUSED
    chair.save()
    assert not unit_mtos(unit).exists()


def test_ptos_lists_active_ptos_and_excludes_a_paused_one():
    active = PTOFactory()
    paused = PTOFactory()
    paused.status = UserStatus.PAUSED
    paused.save()
    MTOFactory()
    assert list(ptos()) == [active]
