"""The one way alerts are created: other apps call `notify(...)`, never `Notification(...)`."""
from collections.abc import Iterable

from django.db.models import QuerySet

from accounts.models import Role, User, UserStatus
from notifications.models import Notification


def notify(recipients: Iterable[User], title: str, body: str = "", link: str = "") -> int:
    """Alert each distinct recipient once. Returns how many alerts were created."""
    distinct = {user.pk: user for user in recipients}
    Notification.objects.bulk_create(
        [Notification(recipient=user, title=title, body=body, link=link) for user in distinct.values()]
    )
    return len(distinct)


def unit_mtos(unit) -> QuerySet[User]:
    """The active MTO chair of a unit."""
    return User.objects.filter(role=Role.MTO, status=UserStatus.ACTIVE, unit=unit)


def ptos() -> QuerySet[User]:
    return User.objects.filter(role=Role.PTO, status=UserStatus.ACTIVE)
