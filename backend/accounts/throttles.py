from hashlib import sha256

from rest_framework.throttling import SimpleRateThrottle

from accounts.models import normalize_username


class LoginIdThrottle(SimpleRateThrottle):
    """Counts login attempts per login ID, so guessing one person's password from many addresses is slowed down too."""

    scope = "login_id"

    def get_cache_key(self, request, view):
        username = request.data.get("username") if hasattr(request.data, "get") else None
        if not isinstance(username, str) or not username.strip():
            return None  # nothing to count; the serializer refuses the request
        ident = sha256(normalize_username(username).encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}
