from django.urls import path
from rest_framework.routers import SimpleRouter

from fuel.views import (
    BunkStatementExportView,
    BunkStatementPumpsView,
    BunkStatementView,
    FuelRequestViewSet,
    FuelStatementExportView,
    FuelStatementView,
    GrantViewSet,
    IncomingViewSet,
    PumpFillsView,
    VehicleQuotaView,
)

router = SimpleRouter()
router.register("grants", GrantViewSet, basename="fuel-grant")
router.register("requests", FuelRequestViewSet, basename="fuel-request")
router.register("incoming", IncomingViewSet, basename="fuel-incoming")

urlpatterns = [
    path("vehicles/<int:pk>/quota/", VehicleQuotaView.as_view(), name="fuel-vehicle-quota"),
    path("pump-fills/", PumpFillsView.as_view(), name="fuel-pump-fills"),
    path("statement/", FuelStatementView.as_view(), name="fuel-statement-report"),
    path("statement/export/", FuelStatementExportView.as_view(), name="fuel-statement-export"),
    path("bunk-statement/", BunkStatementView.as_view(), name="fuel-bunk-statement"),
    path("bunk-statement/export/", BunkStatementExportView.as_view(), name="fuel-bunk-statement-export"),
    path("bunk-statement/pumps/", BunkStatementPumpsView.as_view(), name="fuel-bunk-statement-pumps"),
] + router.urls
