from django.db.models import Q
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts import transfers
from accounts.models import OfficerTransfer, Role, TransferStatus
from accounts.permissions import role_required
from accounts.serializers.transfers import TransferRequestSerializer, TransferSerializer


class TransferViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Officer transfers the caller's office is part of. The new office asks, the old office decides.

    Transfers between two other offices are invisible (404).
    """

    serializer_class = TransferSerializer
    permission_classes = [role_required(Role.MTO)]

    def get_queryset(self):
        unit = self.request.user.unit
        rows = OfficerTransfer.objects.filter(Q(from_unit=unit) | Q(to_unit=unit)).select_related(
            "officer", "from_unit", "to_unit"
        )
        if self.action != "list":
            return rows  # the filter narrows the list only; a stale one must not hide the transfer being acted on
        direction = self.request.query_params.get("direction")
        if direction == "incoming":
            rows = rows.filter(to_unit=unit)
        elif direction == "outgoing":
            rows = rows.filter(from_unit=unit)
        return rows

    def create(self, request, *args, **kwargs):
        serializer = TransferRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        transfer = transfers.request_transfer(
            serializer.validated_data["officer"],
            requesting_unit=request.user.unit,
            requested_by=request.user,
            note=serializer.validated_data["note"].strip(),
        )
        return Response(self._serialize(transfer), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        transfers.accept_transfer(self.get_object(), request.user)
        return Response(self._serialize(self.get_object()))

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        transfers.close_transfer(self.get_object(), request.user, TransferStatus.REJECTED)
        return Response(self._serialize(self.get_object()))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        transfers.close_transfer(self.get_object(), request.user, TransferStatus.CANCELLED)
        return Response(self._serialize(self.get_object()))

    def _serialize(self, transfer):
        """The transfer re-read, so its status and names are fresh."""
        return self.get_serializer(self.get_queryset().get(pk=transfer.pk)).data
