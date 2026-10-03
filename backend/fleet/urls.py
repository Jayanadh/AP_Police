from django.urls import path
from rest_framework.routers import SimpleRouter

from fleet.views import AssignmentViewSet, MyVehiclesView, OdometerViewSet, ServiceDueView, VehicleViewSet

router = SimpleRouter()
router.register("vehicles", VehicleViewSet, basename="vehicle")
router.register("assignments", AssignmentViewSet, basename="assignment")
router.register("odometer", OdometerViewSet, basename="odometer")

urlpatterns = [
    path("me/vehicles/", MyVehiclesView.as_view(), name="my-vehicles"),
    path("service-due/", ServiceDueView.as_view(), name="service-due"),
] + router.urls
