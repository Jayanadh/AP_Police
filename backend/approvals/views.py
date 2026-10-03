from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.models import Role
from accounts.permissions import role_required
from approvals import services
from approvals.models import ApprovalRequest
from approvals.serializers import ApprovalSerializer, DecisionSerializer
from common.exceptions import BusinessRuleError


class ApprovalViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Requests waiting for (or already given) a PTO decision. The PTO sees every unit; an MTO only their own."""

    serializer_class = ApprovalSerializer

    def get_permissions(self):
        if self.action in ("approve", "reject"):
            return [role_required(Role.PTO)()]
        return [role_required(Role.PTO, Role.MTO)()]

    def get_queryset(self):
        approvals = ApprovalRequest.objects.select_related(
            "unit", "officer__designation", "vehicle", "requested_by", "decided_by"
        )
        user = self.request.user
        if user.role == Role.MTO:
            approvals = approvals.filter(unit=user.unit)
        if self.action == "list" and (status := self.request.query_params.get("status")):
            approvals = approvals.filter(status=status)
        return approvals

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, approve=True)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._decide(request, approve=False)

    def _decide(self, request, approve):
        approval = self.get_object()
        serializer = DecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = serializer.validated_data["note"].strip()
        if not approve and not note:
            raise BusinessRuleError("Give a reason for rejecting.")
        services.decide(approval, request.user, approve=approve, note=note)
        return Response(self.get_serializer(self.get_object()).data)
