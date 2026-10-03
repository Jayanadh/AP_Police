from django.urls import path
from rest_framework.routers import SimpleRouter

from pumps.views import PumpDirectoryView, PumpStaffViewSet, PumpViewSet, TankViewSet

router = SimpleRouter()
router.register("pumps", PumpViewSet, basename="pump")
router.register("pump-staff", PumpStaffViewSet, basename="pump-staff")
router.register("tanks", TankViewSet, basename="tank")

urlpatterns = [path("pump-directory/", PumpDirectoryView.as_view(), name="pump-directory")] + router.urls
