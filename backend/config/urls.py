from django.conf import settings
from django.contrib import admin
from django.urls import include, path

from common.views import health

urlpatterns = [
    path("api/health/", health, name="health"),
    path("api/masters/", include("masters.urls")),
    path("api/", include("accounts.urls")),
    path("api/", include("notifications.urls")),
    path("api/", include("fleet.urls")),
    path("api/", include("approvals.urls")),
    path("api/", include("pumps.urls")),
    path("api/fuel/", include("fuel.urls")),
    path("api/tracking/", include("tracking.urls")),
    path("api/", include("dashboards.urls")),
]

if settings.ADMIN_ENABLED:
    urlpatterns.append(path("admin/", admin.site.urls))
