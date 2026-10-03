"""Settings used by pytest: development settings plus a fast password hasher."""
import tempfile
from pathlib import Path

from .settings import *  # noqa: F403

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
MEDIA_ROOT = Path(tempfile.gettempdir()) / "mto-test-media"
