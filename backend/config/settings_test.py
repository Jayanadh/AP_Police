"""Settings used by pytest: development settings plus a fast password hasher and an in-memory cache."""
import tempfile
from pathlib import Path

from .settings import *  # noqa: F403

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
MEDIA_ROOT = Path(tempfile.gettempdir()) / "mto-test-media"
# conftest clears the cache before every test, including those that use no database.
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
