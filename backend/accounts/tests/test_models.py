import pytest
from django.db import IntegrityError

from accounts.models import Role, UserStatus
from testing.factories import PASSWORD, MTOFactory, PTOFactory, UserFactory

pytestmark = pytest.mark.django_db


def test_username_is_stored_lowercase_and_trimmed():
    user = UserFactory(username="  AP12345 ")
    assert user.username == "ap12345"


@pytest.mark.parametrize(
    "status,can_log_in",
    [
        (UserStatus.ACTIVE, True),
        (UserStatus.PAUSED, False),
        (UserStatus.PENDING_APPROVAL, False),
        (UserStatus.TERMINATED, False),
        (UserStatus.REJECTED, False),
    ],
)
def test_only_active_status_can_log_in(status, can_log_in):
    assert UserFactory(status=status).is_active is can_log_in


def test_factory_password_works():
    assert UserFactory().check_password(PASSWORD)


def test_everyone_except_pto_needs_a_unit():
    with pytest.raises(IntegrityError):
        UserFactory(role=Role.DRIVER, unit=None)


def test_pto_needs_no_unit():
    assert PTOFactory().unit is None


def test_only_one_mto_login_per_unit():
    chair = MTOFactory()
    with pytest.raises(IntegrityError):
        MTOFactory(unit=chair.unit)


def test_status_change_with_update_fields_updates_is_active():
    user = UserFactory(status=UserStatus.ACTIVE)
    assert user.is_active is True

    # Pause the user with update_fields
    user.status = UserStatus.PAUSED
    user.save(update_fields=["status"])
    user.refresh_from_db()
    assert user.is_active is False

    # Activate the user again with update_fields
    user.status = UserStatus.ACTIVE
    user.save(update_fields=["status"])
    user.refresh_from_db()
    assert user.is_active is True
