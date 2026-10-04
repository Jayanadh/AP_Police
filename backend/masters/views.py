from collections import Counter

from django.db.models import ProtectedError
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated

from accounts.models import Role
from accounts.permissions import role_required
from common.exceptions import BusinessRuleError

from .models import Cadre, Designation, District
from .serializers import CadreSerializer, DesignationSerializer, DistrictSerializer

# What a master value can be used by, as the PTO would count it: (one, many).
USERS = {"user": ("person", "people"), "unit": ("MTO office", "MTO offices"), "pump": ("pump", "pumps")}


class MasterViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Anyone logged in can read (for dropdowns); only the PTO adds, renames, switches off or deletes. A value that
    people, offices or pumps use is never deleted: their records keep it, and the PTO switches it off instead."""

    http_method_names = ["get", "post", "patch", "delete"]

    def get_permissions(self):
        if self.action == "list":
            return [IsAuthenticated()]
        return [role_required(Role.PTO)()]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get("active") == "1":
            queryset = queryset.filter(is_active=True)
        return queryset

    def perform_destroy(self, instance):
        try:
            instance.delete()
        except ProtectedError as error:
            raise BusinessRuleError(
                f"{instance.name} is used by {_users(error.protected_objects)}, so it can't be deleted. "
                "Switch it off instead."
            ) from None


def _users(objects) -> str:
    """'2 people, 1 MTO office and 1 pump'."""
    counts = Counter(obj._meta.model_name for obj in objects)
    parts = [
        f"{count} {USERS[name][0] if count == 1 else USERS[name][1]}"
        for name, count in sorted(counts.items(), key=lambda item: list(USERS).index(item[0]))
    ]
    return parts[0] if len(parts) == 1 else f"{', '.join(parts[:-1])} and {parts[-1]}"


class DistrictViewSet(MasterViewSet):
    queryset = District.objects.all()
    serializer_class = DistrictSerializer


class DesignationViewSet(MasterViewSet):
    queryset = Designation.objects.all()
    serializer_class = DesignationSerializer


class CadreViewSet(MasterViewSet):
    queryset = Cadre.objects.all()
    serializer_class = CadreSerializer
