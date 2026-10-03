from django.db import transaction
from django.db.models import Exists, OuterRef, Prefetch, Q
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from accounts.models import Role, User, UserStatus
from accounts.permissions import role_required
from accounts.serializers.people import PasswordResetSerializer, PersonSerializer, current_vehicle_links
from accounts.serializers.transfers import OfficerLookupSerializer
from approvals import services as approval_services
from common.exceptions import BusinessRuleError
from fleet import services as fleet_services
from fleet.models import VehicleAssignment


class PersonViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """The MTO's own officers or drivers (set `person_role`). Another office's people are invisible (404)."""

    serializer_class = PersonSerializer
    permission_classes = [role_required(Role.MTO)]
    http_method_names = ["get", "post", "patch"]
    person_role: str

    def get_queryset(self):
        current_links = Prefetch("vehicle_assignments", queryset=current_vehicle_links(), to_attr="current_links")
        people = (
            User.objects.filter(unit=self.request.user.unit, role=self.person_role)
            .select_related("designation", "district", "cadre")
            .prefetch_related(current_links)
        )
        if self.action != "list":
            return people  # filters narrow the list only; a stale one must not hide the person being acted on
        params = self.request.query_params
        if status_value := params.get("status"):
            people = people.filter(status=status_value)
        if search := params.get("search"):
            people = people.filter(Q(full_name__icontains=search) | Q(emp_id__icontains=search))
        if params.get("unassigned") == "1":
            has_vehicle = VehicleAssignment.objects.filter(person=OuterRef("pk"), ended_at__isnull=True)
            people = people.filter(~Exists(has_vehicle))
        return people

    @transaction.atomic
    def perform_create(self, serializer):
        mto = self.request.user
        is_officer = self.person_role == Role.OFFICER
        person = serializer.save(
            unit=mto.unit,
            role=self.person_role,
            status=UserStatus.PENDING_APPROVAL if is_officer else UserStatus.ACTIVE,
            must_change_password=True,
        )
        if is_officer:
            approval_services.request_officer_approval(person, requested_by=mto)

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        return self._change_status(
            self.get_object(), UserStatus.ACTIVE, UserStatus.PAUSED, "Only active people can be paused."
        )

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        return self._change_status(
            self.get_object(), UserStatus.PAUSED, UserStatus.ACTIVE, "Only paused people can be resumed."
        )

    @action(detail=True, methods=["post"])
    def terminate(self, request, pk=None):
        person = self.get_object()
        with transaction.atomic():
            locked = User.objects.select_for_update().get(pk=person.pk)
            if locked.status == UserStatus.PENDING_APPROVAL:
                raise BusinessRuleError("This person is waiting for PTO approval.")
            if locked.status in (UserStatus.TERMINATED, UserStatus.REJECTED):
                raise BusinessRuleError("This person is already removed.")
            locked.status = UserStatus.TERMINATED
            locked.save(update_fields=["status"])  # User.save keeps is_active in step
            fleet_services.end_all_for_person(locked, ended_by=request.user)
        return self._person_response(person)

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        person = self.get_object()
        serializer = PasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        person.set_password(serializer.validated_data["password"])
        person.must_change_password = True
        person.save(update_fields=["password", "must_change_password"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _change_status(self, person, expected, new, refusal):
        with transaction.atomic():
            # Re-read under a lock so a stale read cannot change a status that has moved on.
            locked = User.objects.select_for_update().get(pk=person.pk)
            if locked.status != expected:
                raise BusinessRuleError(refusal)
            locked.status = new
            locked.save(update_fields=["status"])  # User.save keeps is_active in step
        return self._person_response(person)

    def _person_response(self, person):
        """The person re-read, so status and current_vehicles are fresh."""
        return Response(self.get_serializer(self.get_queryset().get(pk=person.pk)).data)


class DriverViewSet(PersonViewSet):
    person_role = Role.DRIVER


class OfficerViewSet(PersonViewSet):
    person_role = Role.OFFICER

    @action(detail=False, methods=["get"])
    def lookup(self, request):
        """Find an active or paused officer of another MTO office by exact Emp ID, to ask for a transfer."""
        emp_id = request.query_params.get("emp_id", "").strip().upper()
        officer = None
        if emp_id:
            officer = (
                User.objects.filter(
                    role=Role.OFFICER, emp_id=emp_id, status__in=(UserStatus.ACTIVE, UserStatus.PAUSED)
                )
                .exclude(unit=request.user.unit)
                .select_related("designation", "unit")
                .first()
            )
        if officer is None:
            raise NotFound("No officer with this Emp ID in another MTO office.")
        return Response(OfficerLookupSerializer(officer).data)
