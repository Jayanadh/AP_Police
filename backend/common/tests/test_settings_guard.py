"""The settings refuse unsafe configurations at start-up and are secure by default in production."""
import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
GUARD_MESSAGE = "Set DJANGO_SECRET_KEY when DJANGO_DEBUG=0."


def run_python(*args: str, **env: str) -> subprocess.CompletedProcess:
    """Run Python in the backend folder with only the given DJANGO_* variables, so module-level checks run for real."""
    clean = {key: value for key, value in os.environ.items() if not key.startswith("DJANGO_")}
    return subprocess.run(
        [sys.executable, *args], cwd=BACKEND_DIR, env={**clean, **env}, capture_output=True, text=True, timeout=60
    )


def import_settings(module: str, **env: str) -> subprocess.CompletedProcess:
    return run_python("-c", f"import importlib; importlib.import_module({module!r})", **env)


def test_debug_off_without_a_secret_key_is_refused():
    result = import_settings("config.settings", DJANGO_DEBUG="0")

    assert result.returncode != 0
    assert f"django.core.exceptions.ImproperlyConfigured: {GUARD_MESSAGE}" in result.stderr


def test_debug_off_with_a_secret_key_starts():
    result = import_settings("config.settings", DJANGO_DEBUG="0", DJANGO_SECRET_KEY="a-real-secret-value")

    assert result.returncode == 0, result.stderr


def test_debug_off_with_the_development_key_spelled_out_is_still_refused():
    result = import_settings(
        "config.settings", DJANGO_DEBUG="0", DJANGO_SECRET_KEY="dev-only-insecure-key-change-me"
    )

    assert result.returncode != 0
    assert GUARD_MESSAGE in result.stderr


def test_debug_off_with_the_env_example_placeholder_is_still_refused():
    result = import_settings("config.settings", DJANGO_DEBUG="0", DJANGO_SECRET_KEY="change-me")

    assert result.returncode != 0
    assert f"django.core.exceptions.ImproperlyConfigured: {GUARD_MESSAGE}" in result.stderr


def test_development_defaults_still_start():
    assert import_settings("config.settings").returncode == 0


def test_test_settings_still_start():
    result = import_settings("config.settings_test")

    assert result.returncode == 0, result.stderr


def settings_values(*names: str, **env: str) -> list[str]:
    """The repr of each named setting, read from config.settings in a fresh interpreter with `env`."""
    reads = ", ".join(f"repr(getattr(s, {name!r}, None))" for name in names)
    result = run_python("-c", f"import config.settings as s; print('\\n'.join([{reads}]))", **env)
    assert result.returncode == 0, result.stderr
    return result.stdout.splitlines()


PRODUCTION = {"DJANGO_DEBUG": "0", "DJANGO_SECRET_KEY": "a-real-secret-value"}


def test_debug_on_cannot_serve_a_public_host():
    result = import_settings("config.settings", DJANGO_ALLOWED_HOSTS="localhost,mto.example.gov.in")

    assert result.returncode != 0
    assert (
        "django.core.exceptions.ImproperlyConfigured: DJANGO_DEBUG=1 is for development; "
        "set DJANGO_DEBUG=0 to serve mto.example.gov.in." in result.stderr
    )


def test_debug_on_may_serve_this_machine_and_the_local_network():
    hosts = "localhost,127.0.0.1,[::1],app.localhost,192.168.1.20,10.0.0.5"

    assert import_settings("config.settings", DJANGO_ALLOWED_HOSTS=hosts).returncode == 0


def test_production_redirects_to_https_and_sends_hsts_by_default():
    ssl_redirect, hsts, proxy_header = settings_values(
        "SECURE_SSL_REDIRECT", "SECURE_HSTS_SECONDS", "SECURE_PROXY_SSL_HEADER", **PRODUCTION
    )

    assert (ssl_redirect, hsts, proxy_header) == ("True", "31536000", "None")


def test_development_neither_redirects_nor_sends_hsts():
    assert settings_values("SECURE_SSL_REDIRECT", "SECURE_HSTS_SECONDS") == ["False", "0"]


def test_the_client_address_is_the_connections_own_unless_proxies_are_declared():
    """A client could otherwise send a made-up X-Forwarded-For with every login attempt to dodge the throttle."""
    assert settings_values("REST_FRAMEWORK", **PRODUCTION)[0].count("'NUM_PROXIES': 0") == 1

    rest, proxy_header = settings_values(
        "REST_FRAMEWORK", "SECURE_PROXY_SSL_HEADER", DJANGO_PROXY_COUNT="1", **PRODUCTION
    )
    assert "'NUM_PROXIES': 1" in rest
    assert proxy_header == "('HTTP_X_FORWARDED_PROTO', 'https')"


def test_the_django_admin_is_off_in_production_unless_asked_for():
    assert settings_values("ADMIN_ENABLED") == ["True"]
    assert settings_values("ADMIN_ENABLED", **PRODUCTION) == ["False"]
    assert settings_values("ADMIN_ENABLED", DJANGO_ADMIN="1", **PRODUCTION) == ["True"]


def test_production_passes_djangos_deployment_checklist():
    """HSTS for subdomains and preloading are left off on purpose: other services may share the domain."""
    result = run_python(
        "manage.py", "check", "--deploy", "--fail-level", "WARNING",
        DJANGO_DEBUG="0",
        DJANGO_SECRET_KEY="test-only-" + "k3Y-v4Lu3-" * 5,
        DJANGO_ALLOWED_HOSTS="mto.example.gov.in",
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_throttling_counts_live_in_the_database_so_every_worker_shares_them():
    """Login and location throttling count in the cache; a cache in each gunicorn worker would let every worker
    allow the full number of attempts."""
    [caches] = settings_values("CACHES", **PRODUCTION)

    assert "'BACKEND': 'django.core.cache.backends.db.DatabaseCache'" in caches
