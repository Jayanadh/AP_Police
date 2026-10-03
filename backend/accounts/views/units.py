from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from accounts.models import Role, Unit
from accounts.permissions import role_required
from accounts.serializers.units import ChairHolderSerializer, UnitCreateSerializer, UnitSerializer


class UnitViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """MTO offices, with their chair's details: the PTO's alone."""

    queryset = Unit.objects.select_related("district")
    http_method_names = ["get", "post", "patch"]

    permission_classes = [role_required(Role.PTO)]

    def get_serializer_class(self):
        return UnitCreateSerializer if self.action == "create" else UnitSerializer

    @action(detail=True, methods=["post"])
    def handover(self, request, pk=None):
        unit = self.get_object()
        try:
            chair = unit.members.get(role=Role.MTO)
        except unit.members.model.DoesNotExist:
            raise NotFound("This office has no MTO chair.")
        serializer = ChairHolderSerializer(data=request.data, context={"chair": chair})
        serializer.is_valid(raise_exception=True)
        holder = dict(serializer.validated_data)
        chair.set_password(holder.pop("password"))
        holder.setdefault("mobile", "")
        for field, value in holder.items():
            setattr(chair, field, value)
        chair.must_change_password = True
        chair.save()
        return Response(UnitSerializer(unit).data)
