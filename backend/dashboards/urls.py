from django.urls import path

from accounts.models import Role
from dashboards.views import (
    DashboardView,
    MonitorPeopleExportView,
    MonitorPeopleView,
    MonitorVehiclesExportView,
    MonitorVehiclesView,
)

urlpatterns = [
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    path("monitor/vehicles/", MonitorVehiclesView.as_view(), name="monitor-vehicles"),
    path("monitor/officers/", MonitorPeopleView.as_view(person_role=Role.OFFICER), name="monitor-officers"),
    path("monitor/drivers/", MonitorPeopleView.as_view(person_role=Role.DRIVER), name="monitor-drivers"),
    path("monitor/vehicles/export/", MonitorVehiclesExportView.as_view(), name="monitor-vehicles-export"),
    path(
        "monitor/officers/export/",
        MonitorPeopleExportView.as_view(person_role=Role.OFFICER),
        name="monitor-officers-export",
    ),
    path(
        "monitor/drivers/export/",
        MonitorPeopleExportView.as_view(person_role=Role.DRIVER),
        name="monitor-drivers-export",
    ),
]
