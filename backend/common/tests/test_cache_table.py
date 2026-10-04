import pytest
from django.core.management import call_command
from django.db import connection
from django.test import override_settings

pytestmark = pytest.mark.django_db

DATABASE_CACHE = {"default": {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "mto_cache"}}


@override_settings(CACHES=DATABASE_CACHE)
def test_migrating_makes_the_cache_table():
    with connection.cursor() as cursor:
        cursor.execute("DROP TABLE IF EXISTS mto_cache")

    call_command("migrate", "common", "zero", verbosity=0)
    call_command("migrate", "common", verbosity=0)

    assert "mto_cache" in connection.introspection.table_names()
