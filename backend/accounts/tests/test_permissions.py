import pytest
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework.views import APIView

from accounts.models import Role
from accounts.permissions import role_required
from testing.factories import DriverFactory, MTOFactory, PTOFactory

pytestmark = pytest.mark.django_db


class MTOAndPTOOnly(APIView):
    permission_classes = [role_required(Role.MTO, Role.PTO)]

    def get(self, request):
        return Response({"ok": True})


def call_as(user):
    request = APIRequestFactory().get("/anything/")
    if user is not None:
        force_authenticate(request, user=user)
    return MTOAndPTOOnly.as_view()(request)


def test_listed_roles_are_allowed():
    assert call_as(MTOFactory()).status_code == 200
    assert call_as(PTOFactory()).status_code == 200


def test_other_roles_are_refused():
    assert call_as(DriverFactory()).status_code == 403


def test_anonymous_is_refused():
    assert call_as(None).status_code == 403
