from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated

from accounts.models import Role
from accounts.permissions import role_required

from .models import Cadre, Designation, District
from .serializers import CadreSerializer, DesignationSerializer, DistrictSerializer


class MasterViewSet(
    mixins.ListModelMixin, mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet
):
    """Anyone logged in can read (for dropdowns); only the PTO adds, renames or deactivates."""

    http_method_names = ["get", "post", "patch"]

    def get_permissions(self):
        if self.action == "list":
            return [IsAuthenticated()]
        return [role_required(Role.PTO)()]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get("active") == "1":
            queryset = queryset.filter(is_active=True)
        return queryset


class DistrictViewSet(MasterViewSet):
    queryset = District.objects.all()
    serializer_class = DistrictSerializer


class DesignationViewSet(MasterViewSet):
    queryset = Designation.objects.all()
    serializer_class = DesignationSerializer


class CadreViewSet(MasterViewSet):
    queryset = Cadre.objects.all()
    serializer_class = CadreSerializer
