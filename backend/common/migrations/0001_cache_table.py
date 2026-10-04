"""The cache's table. Login and location throttling count attempts in the cache, and every gunicorn worker must see
the same counts, so the cache lives in the database (see CACHES in the settings). Safe to run on a database that
already has the table."""
from django.core.management import call_command
from django.db import migrations


def create_cache_table(apps, schema_editor):
    call_command("createcachetable", database=schema_editor.connection.alias, verbosity=0)


class Migration(migrations.Migration):
    dependencies = []

    operations = [migrations.RunPython(create_cache_table, migrations.RunPython.noop)]
