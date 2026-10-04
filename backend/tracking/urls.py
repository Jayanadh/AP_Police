from django.urls import path
from rest_framework.routers import SimpleRouter

from tracking.views import LiveBoardView, TripViewSet

router = SimpleRouter()
router.register("trips", TripViewSet, basename="tracking-trip")

urlpatterns = [
    path("live/", LiveBoardView.as_view(), name="tracking-live"),
] + router.urls
