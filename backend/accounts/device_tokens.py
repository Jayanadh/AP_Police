"""Device tokens: how the Android and iOS apps sign in (see docs/mobile-apps.md).

The app signs in once with the login ID and password and keeps the token it gets back. It then sends it on every
call as `Authorization: Bearer <token>`, with no cookies and so no CSRF token, which also lets a background location
service post on its own. Only the token's SHA-256 is stored.
"""
import secrets
from datetime import timedelta
from hashlib import sha256

from django.conf import settings
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied

from accounts.middleware import MUST_CHANGE_PASSWORD, OPEN_WHILE_PASSWORD_MUST_CHANGE
from accounts.models import DeviceToken, User

MAX_DEVICES = 5
# How often the last use is written down: not on every call, or every location batch would be a write.
NOTE_USE_EVERY = timedelta(minutes=5)
SIGN_IN_AGAIN = "Sign in again."


def _hash(key: str) -> str:
    return sha256(key.encode()).hexdigest()


def issue(user: User, name: str = "") -> tuple[DeviceToken, str]:
    """A token for one of the person's devices, and its key, which is shown only this once. Beyond their five newest
    devices the oldest are signed out."""
    key = secrets.token_urlsafe(32)
    token = DeviceToken.objects.create(
        user=user,
        key_hash=_hash(key),
        password_mark=user.get_session_auth_hash(),
        name=name,
        expires_at=timezone.now() + timedelta(days=settings.MTO_RULES["DEVICE_TOKEN_DAYS"]),
    )
    newest = list(user.device_tokens.values_list("pk", flat=True)[:MAX_DEVICES])
    user.device_tokens.exclude(pk__in=newest).delete()
    return token, key


def keep_signed_in(token: DeviceToken) -> None:
    """After the person changed their password on this device: this token carries on; every other one has ended."""
    token.password_mark = token.user.get_session_auth_hash()
    token.save(update_fields=["password_mark"])


class DeviceTokenAuthentication(BaseAuthentication):
    """Signs a call in by its `Authorization: Bearer` token. Listed after the session, so the web app is unchanged."""

    def authenticate(self, request):
        header = get_authorization_header(request).split()
        if not header or header[0].lower() != b"bearer":
            return None  # not the app's way in
        if len(header) != 2:
            raise AuthenticationFailed(SIGN_IN_AGAIN)
        try:
            key = header[1].decode("ascii")
        except UnicodeDecodeError:
            raise AuthenticationFailed(SIGN_IN_AGAIN) from None
        now = timezone.now()
        token = DeviceToken.objects.select_related("user").filter(key_hash=_hash(key), expires_at__gt=now).first()
        if (
            token is None
            or not token.user.is_active
            or not constant_time_compare(token.password_mark, token.user.get_session_auth_hash())
        ):
            raise AuthenticationFailed(SIGN_IN_AGAIN)
        if token.user.must_change_password and request.path not in OPEN_WHILE_PASSWORD_MUST_CHANGE:
            raise PermissionDenied(MUST_CHANGE_PASSWORD)
        if token.last_used_at is None or now - token.last_used_at >= NOTE_USE_EVERY:
            DeviceToken.objects.filter(pk=token.pk).update(last_used_at=now)
        return token.user, token
