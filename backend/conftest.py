import pytest
from django.core.cache import cache
from rest_framework.test import APIClient


@pytest.fixture(autouse=True)
def _fresh_cache():
    """Login throttling counts live in the cache, so every test starts from zero."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api():
    return APIClient()
