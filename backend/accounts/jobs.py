"""Scheduled account jobs. Each takes an aware `now`, returns how many records it acted on and is safe to run again."""
from datetime import datetime

from accounts.models import DeviceToken


def delete_expired_device_tokens(now: datetime) -> int:
    """Forget the phone app sign-ins that have run out."""
    deleted, _ = DeviceToken.objects.filter(expires_at__lte=now).delete()
    return deleted
