from django.urls import path
from rest_framework.routers import SimpleRouter

from accounts.views.auth import ChangePasswordView, LoginView, LogoutView, SessionView
from accounts.views.people import DriverViewSet, OfficerViewSet
from accounts.views.transfers import TransferViewSet
from accounts.views.units import UnitViewSet

router = SimpleRouter()
router.register("units", UnitViewSet, basename="unit")
router.register("drivers", DriverViewSet, basename="driver")
router.register("officers", OfficerViewSet, basename="officer")
router.register("transfers", TransferViewSet, basename="transfer")

urlpatterns = [
    path("auth/session/", SessionView.as_view(), name="auth-session"),
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/change-password/", ChangePasswordView.as_view(), name="auth-change-password"),
] + router.urls
