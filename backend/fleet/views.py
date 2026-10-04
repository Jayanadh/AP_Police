from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role, User
from accounts.permissions import role_required
from approvals import services as approval_services
from common.excel import Sheet, xlsx_response
from common.exceptions import BusinessRuleError
from common.months import today_ist
from common.params import vehicle_id
from fleet import odometer, servicing, services
from fleet.models import AssignmentKind, Vehicle, VehicleAssignment, VehicleStatus, normalize_registration
from fleet.serializers import (
    AssignmentSerializer,
    AssignSerializer,
    MyVehicleSerializer,
    OdometerReadingSerializer,
    OdometerSubmitSerializer,
    ServiceRecordSerializer,
    TerminationRequestSerializer,
    VehicleSerializer,
)


class VehicleViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """The MTO's own vehicles. Another office's vehicles are invisible (404)."""

    serializer_class = VehicleSerializer
    permission_classes = [role_required(Role.MTO)]
    http_method_names = ["get", "post", "patch"]

    def get_queryset(self):
        vehicles = Vehicle.objects.filter(unit=self.request.user.unit)
        vehicles = vehicles.prefetch_related(services.current_links_prefetch())
        if self.action != "list":  # the filters narrow the list; they must not hide a vehicle that is asked for by id
            return vehicles
        params = self.request.query_params
        if status := params.get("status"):
            vehicles = vehicles.filter(status=status)
        if search := params.get("search"):
            vehicles = vehicles.filter(registration_number__contains=normalize_registration(search))
        return vehicles

    def perform_create(self, serializer):
        serializer.save(unit=self.request.user.unit, status=VehicleStatus.ACTIVE)

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        return self._change_status(
            self.get_object(), VehicleStatus.ACTIVE, VehicleStatus.PAUSED, "Only active vehicles can be paused."
        )

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        return self._change_status(
            self.get_object(), VehicleStatus.PAUSED, VehicleStatus.ACTIVE, "Only paused vehicles can be resumed."
        )

    @action(detail=True, methods=["post"], url_path="request-termination")
    def request_termination(self, request, pk=None):
        vehicle = self.get_object()
        serializer = TerminationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        approval_services.request_vehicle_termination(vehicle, request.user, serializer.validated_data["note"])
        vehicle.refresh_from_db()
        return Response(self.get_serializer(vehicle).data)

    @action(detail=True, methods=["get", "post"])
    def assignments(self, request, pk=None):
        """GET: every link of this vehicle, current and ended, newest first. POST {person}: link someone."""
        vehicle = self.get_object()
        if request.method == "GET":
            links = vehicle.assignments.select_related("person", "assigned_by", "ended_by")
            return Response(AssignmentSerializer(links, many=True).data)
        serializer = AssignSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        link = services.assign_person(vehicle, serializer.validated_data["person"], assigned_by=request.user)
        return Response(AssignmentSerializer(link).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="assignments/export")
    def assignments_export(self, request, pk=None):
        """The link history as an Excel file: drivers and officers on their own sheets, newest first."""
        vehicle = self.get_object()
        links = vehicle.assignments.select_related("person", "assigned_by", "ended_by")
        headers = ["Name", "Emp ID", "From", "To", "Linked by", "Ended by"]

        def rows(kind):
            return [
                [
                    link.person.full_name, link.person.emp_id or "", link.started_at, link.ended_at or "Current",
                    link.assigned_by.full_name, link.ended_by.full_name if link.ended_by else None,
                ]
                for link in links
                if link.kind == kind
            ]

        return xlsx_response(
            f"link-history-{vehicle.registration_number}.xlsx",
            [
                Sheet("Drivers", headers, rows(AssignmentKind.DRIVER)),
                Sheet("Officers", headers, rows(AssignmentKind.OFFICER)),
            ],
        )

    @action(detail=True, methods=["get", "post"], url_path="services")
    def service_records(self, request, pk=None):
        """GET: this vehicle's services, newest first. POST {service_date, odometer_km, notes}: record one."""
        vehicle = self.get_object()
        if request.method == "GET":
            records = vehicle.service_records.select_related("recorded_by")
            return Response(ServiceRecordSerializer(records, many=True).data)
        serializer = ServiceRecordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        record = servicing.record_service(
            vehicle, data["service_date"], data["odometer_km"], data.get("notes", ""), by=request.user
        )
        return Response(ServiceRecordSerializer(record).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="service-status")
    def service_status(self, request, pk=None):
        return Response(servicing.service_status(self.get_object(), today_ist()))

    def _change_status(self, vehicle, expected, new, refusal):
        # Conditional update: refuses if the status changed since this request read the vehicle.
        changed = Vehicle.objects.filter(pk=vehicle.pk, status=expected).update(status=new, updated_at=timezone.now())
        if not changed:
            raise BusinessRuleError(refusal)
        vehicle.refresh_from_db()
        return Response(self.get_serializer(vehicle).data)


class AssignmentViewSet(viewsets.GenericViewSet):
    """Vehicle links of the MTO's own vehicles; only `end` is offered. Another office's links are invisible (404)."""

    serializer_class = AssignmentSerializer
    permission_classes = [role_required(Role.MTO)]

    def get_queryset(self):
        return VehicleAssignment.objects.filter(vehicle__unit=self.request.user.unit).select_related(
            "person", "assigned_by", "ended_by"
        )

    @action(detail=True, methods=["post"])
    def end(self, request, pk=None):
        link = self.get_object()
        services.end_assignment(link, ended_by=request.user)
        return Response(self.get_serializer(link).data)


class OdometerViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Sunday odometer readings. The driver records the reading of their vehicle; the MTO (own unit), officers and
    drivers (their linked vehicles) read them. A vehicle outside the caller's scope is invisible (404)."""

    serializer_class = OdometerReadingSerializer
    http_method_names = ["get", "post"]

    def get_permissions(self):
        if self.action == "create":
            return [role_required(Role.DRIVER)()]
        if self.action == "missing":
            return [role_required(Role.MTO)()]
        return [role_required(Role.MTO, Role.OFFICER, Role.DRIVER)()]

    def get_queryset(self):
        visible = services.vehicles_visible_to(self.request.user)
        readings = odometer.readings_with_previous().filter(vehicle__in=visible)
        if (vehicle := vehicle_id(self.request.query_params)) is not None:
            readings = readings.filter(vehicle=get_object_or_404(visible, pk=vehicle))
        return readings

    def create(self, request, *args, **kwargs):
        serializer = OdometerSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reading = odometer.record_reading(request.user, serializer.validated_data["reading_km"])
        reading = odometer.readings_with_previous().get(pk=reading.pk)
        return Response(OdometerReadingSerializer(reading).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def missing(self, request):
        """The unit's active vehicles that have a driver but no reading for this week's Sunday."""
        week = odometer.week_of(today_ist())
        links = odometer.missing_readings(request.user.unit_id, week)
        return Response(
            [
                {
                    "vehicle": link.vehicle_id,
                    "registration_number": link.vehicle.registration_number,
                    "driver_name": link.person.full_name,
                    "week_of": week,
                }
                for link in links
            ]
        )


class ServiceDueView(APIView):
    """The unit's vehicles that are due for a service now, each with its service status."""

    permission_classes = [role_required(Role.MTO)]

    def get(self, request):
        due = servicing.due_for_service(request.user.unit_id, today_ist())
        return Response(
            [
                {"vehicle": vehicle.id, "registration_number": vehicle.registration_number, **service}
                for vehicle, service in due
            ]
        )


class MyVehiclesView(APIView):
    """The officer's or driver's vehicles (those they are linked to now), and who to call at their MTO office."""

    permission_classes = [role_required(Role.OFFICER, Role.DRIVER)]

    def get(self, request):
        user = request.user
        vehicles = odometer.with_latest_odometer_km(
            Vehicle.objects.filter(
                assignments__person=user, assignments__ended_at__isnull=True  # one filter(): the same link row
            ).prefetch_related(services.current_links_prefetch())
        )
        mto = User.objects.filter(unit=user.unit, role=Role.MTO).first()
        return Response(
            {
                "vehicles": MyVehicleSerializer(vehicles, many=True).data,
                "mto": {
                    "unit_name": user.unit.name,
                    "full_name": mto.full_name if mto else None,
                    "mobile": mto.mobile if mto else None,
                },
            }
        )
