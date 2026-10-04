from pathlib import PurePath

from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404
from rest_framework import generics, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role
from accounts.permissions import role_required
from common.exceptions import BusinessRuleError
from common.months import parse_month
from common.params import office_id, pump_id, vehicle_id
from common.periods import parse_period
from fleet import services
from fleet.models import AssignmentKind
from fuel import exports, redeem, report, requests
from fuel.models import EmergencyStatus, FuelGrant, FuelRequest
from fuel.quota import fmt, quota_for
from fuel.serializers import (
    CheckedRequestSerializer,
    DutySerializer,
    FuelGrantSerializer,
    FuelRequestCreateSerializer,
    FuelRequestSerializer,
    IncomingRequestSerializer,
    PinSerializer,
    PumpFillSerializer,
    quota_payload,
)
from notifications.service import notify
from pumps.models import Pump

LINK_BY_KIND = {AssignmentKind.OFFICER: "/officer", AssignmentKind.DRIVER: "/driver"}


class GrantViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Additional quota: added by the MTO, listed for the MTO's own unit and for the PTO (all). Letters of any
    other unit are invisible (404)."""

    serializer_class = FuelGrantSerializer
    http_method_names = ["get", "post"]

    def get_permissions(self):
        if self.action == "create":
            return [role_required(Role.MTO)()]
        if self.action == "list":
            return [role_required(Role.MTO, Role.PTO)()]
        return [IsAuthenticated()]  # the letter: who may see it is decided by get_queryset

    def get_queryset(self):
        user = self.request.user
        grants = FuelGrant.objects.select_related("vehicle", "created_by")
        if user.role == Role.MTO:
            grants = grants.filter(vehicle__unit=user.unit_id)
        elif user.role != Role.PTO:
            return grants.none()
        if self.action == "list":
            params = self.request.query_params
            if (vehicle := vehicle_id(params)) is not None:
                grants = grants.filter(vehicle=vehicle)
            if params.get("month"):
                grants = grants.filter(month=parse_month(params["month"]))
        return grants

    @transaction.atomic
    def perform_create(self, serializer):
        grant = serializer.save(created_by=self.request.user)
        _notify_vehicle_people(grant)

    @action(detail=True, methods=["get"])
    def letter(self, request, pk=None):
        grant = self.get_object()
        try:
            file = grant.letter.open("rb")
        except FileNotFoundError:
            raise Http404("The letter is no longer on file.") from None
        return FileResponse(file, as_attachment=True, filename=PurePath(grant.letter.name).name)


def _notify_vehicle_people(grant: FuelGrant) -> None:
    vehicle = grant.vehicle
    title = f"Additional fuel for {vehicle.registration_number}"
    body = f"{fmt(grant.litres)} L added for {grant.month:%B %Y}."
    for link in services.current_links(vehicle):
        notify([link.person], title, body, LINK_BY_KIND[link.kind])


class VehicleQuotaView(APIView):
    """One vehicle's fuel for a month. A vehicle the caller may not see is 404."""

    def get(self, request, pk):
        vehicle = get_object_or_404(services.vehicles_visible_to(request.user), pk=pk)
        month = parse_month(request.query_params.get("month"))
        return Response(quota_payload(quota_for(vehicle, month)))


EMERGENCY_FILTERS = {"pending": EmergencyStatus.PENDING, "allowed": EmergencyStatus.ALLOWED}


class FuelRequestViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Fuel requests. Drivers raise, cancel and write the duty particulars of their own; the MTO allows emergency fills
    of their unit; drivers, officers, the MTO and the PTO read the ones in their scope. Anything outside the caller's
    scope is invisible (404)."""

    serializer_class = FuelRequestSerializer
    http_method_names = ["get", "post"]

    def get_permissions(self):
        if self.action == "create":
            return [role_required(Role.DRIVER)()]
        if self.action == "list":
            return [role_required(Role.DRIVER, Role.OFFICER, Role.MTO, Role.PTO)()]
        if self.action == "allow_emergency":
            return [role_required(Role.MTO)()]
        return [IsAuthenticated()]  # cancel, duty: whose request it is is decided by get_queryset

    def get_queryset(self):
        user = self.request.user
        fuel_requests = FuelRequest.objects.select_related("vehicle", "driver", "pump")
        if self.action in ("cancel", "duty") or user.role == Role.DRIVER:
            return self._filtered(fuel_requests.filter(driver=user))
        return self._filtered(fuel_requests.filter(vehicle__in=services.vehicles_visible_to(user)))

    def _filtered(self, fuel_requests):
        if self.action != "list":
            return fuel_requests
        params = self.request.query_params
        if bounds := _requested_bounds(params):
            start, end = bounds
            # A filled request belongs to the day it was filled (that is where its litres count against the quota);
            # one not filled yet, to the day it was raised.
            fuel_requests = fuel_requests.filter(
                Q(filled_at__gte=start, filled_at__lt=end)
                | Q(filled_at__isnull=True, issued_at__gte=start, issued_at__lt=end)
            )
        if (unit := office_id(params)) is not None:
            fuel_requests = fuel_requests.filter(vehicle__unit=unit)
        if request_status := params.get("status"):
            fuel_requests = fuel_requests.filter(status=request_status)
        if (vehicle := vehicle_id(params)) is not None:
            fuel_requests = fuel_requests.filter(vehicle=vehicle)
        if emergency := params.get("emergency"):
            if emergency not in EMERGENCY_FILTERS:
                raise BusinessRuleError("Use emergency=pending or emergency=allowed.")
            fuel_requests = fuel_requests.filter(emergency_status=EMERGENCY_FILTERS[emergency])
        return fuel_requests

    def list(self, request, *args, **kwargs):
        requests.expire_stale()  # statuses are read as they stand, so bring them up to date first
        return super().list(request, *args, **kwargs)

    def create(self, request):
        inputs = FuelRequestCreateSerializer(data=request.data)
        inputs.is_valid(raise_exception=True)
        raised = requests.create_request(
            driver=request.user,
            pump=inputs.validated_data["pump"],
            litres=inputs.validated_data["litres"],
            is_emergency=inputs.validated_data["is_emergency"],
            reason=inputs.validated_data["emergency_reason"],
        )
        return Response(self.get_serializer(raised).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        cancelled = requests.cancel_request(self.get_object(), request.user)
        return Response(self.get_serializer(cancelled).data)

    @action(detail=True, methods=["post"])
    def duty(self, request, pk=None):
        fuel_request = self.get_object()
        inputs = DutySerializer(data=request.data)
        inputs.is_valid(raise_exception=True)
        updated = requests.submit_duty(fuel_request, request.user, inputs.validated_data["duty_particulars"])
        return Response(self.get_serializer(updated).data)

    @action(detail=True, methods=["post"], url_path="allow-emergency")
    def allow_emergency(self, request, pk=None):
        allowed = requests.allow_emergency(self.get_object(), request.user)
        return Response(self.get_serializer(allowed).data)


def _requested_bounds(params):
    """The `[start, end)` range named by `from` and `to` (both days included), or None when neither is given."""
    if params.get("from") or params.get("to"):
        return parse_period(params).bounds()
    return None


class IncomingViewSet(viewsets.GenericViewSet):
    """The requests waiting at the operator's own pump. The staff pick one, check the driver's PIN to see the litres,
    and fill exactly those litres. A request of another pump is invisible (404)."""

    permission_classes = [role_required(Role.PUMP_OPERATOR)]
    serializer_class = IncomingRequestSerializer
    pagination_class = None
    lookup_value_regex = r"\d+"

    def list(self, request):
        return Response(self.get_serializer(redeem.incoming(request.user), many=True).data)

    @action(detail=True, methods=["post"], url_path="check-pin")
    def check_pin(self, request, pk=None):
        checked = redeem.check_pin(operator=request.user, request_id=int(pk), pin=self._pin())
        return Response(CheckedRequestSerializer(checked).data)

    @action(detail=True, methods=["post"])
    def fill(self, request, pk=None):
        filled = redeem.fill(operator=request.user, request_id=int(pk), pin=self._pin())
        return Response(FuelRequestSerializer(filled, context={"request": request}).data)

    def _pin(self) -> str:
        inputs = PinSerializer(data=self.request.data)
        inputs.is_valid(raise_exception=True)
        return inputs.validated_data["pin"]


class PumpFillsView(generics.ListAPIView):
    """The fills made at the operator's own pump in a period (`?from=&to=`; this month when not given), newest
    first, each with the officer of the vehicle."""

    serializer_class = PumpFillSerializer
    permission_classes = [role_required(Role.PUMP_OPERATOR)]
    pagination_class = None

    def get_queryset(self):
        return report.pump_fills(self.request.user.pump_id, parse_period(self.request.query_params))


class FuelStatementView(APIView):
    """What was filled in a period (`?from=YYYY-MM-DD&to=YYYY-MM-DD`, this month when not given) as the caller sees
    it. The PTO may narrow it to one office with `?unit=<id>`."""

    def get(self, request):
        return Response(report.fuel_statement(request.user, *_statement_scope(request)))


class FuelStatementExportView(APIView):
    """The same statement as an Excel file, with every fill."""

    def get(self, request):
        return exports.fuel_statement(request.user, *_statement_scope(request))


def _statement_scope(request):
    period = parse_period(request.query_params)
    unit = office_id(request.query_params) if request.user.role == Role.PTO else None
    return period, unit


class BunkStatementView(APIView):
    """Every fill made at one pump in a period (`?pump=<id>&from=&to=`; this month when no dates are given), with the
    totals. Pump staff get their own pump without naming it; the MTO picks one of the office's pumps, the PTO any.
    A pump outside the caller's scope is invisible (404)."""

    permission_classes = [role_required(Role.PUMP_OPERATOR, Role.MTO, Role.PTO)]

    def get(self, request):
        return Response(report.bunk_statement(*_bunk_scope(request)))


class BunkStatementExportView(APIView):
    """The same bunk statement as an Excel file."""

    permission_classes = [role_required(Role.PUMP_OPERATOR, Role.MTO, Role.PTO)]

    def get(self, request):
        return exports.bunk_statement(*_bunk_scope(request))


class BunkStatementPumpsView(APIView):
    """The pumps the MTO (their office's, closed ones too) or the PTO (every office's, `?unit=` for one) can draw a
    bunk statement up for."""

    permission_classes = [role_required(Role.MTO, Role.PTO)]

    def get(self, request):
        pumps = Pump.objects.select_related("unit").order_by("unit__name", "name", "id")
        if request.user.role == Role.MTO:
            pumps = pumps.filter(unit=request.user.unit_id)
        elif (unit := office_id(request.query_params)) is not None:
            pumps = pumps.filter(unit=unit)
        return Response(
            [
                {
                    "id": pump.id,
                    "name": pump.name,
                    "kind": pump.kind,
                    "kind_label": pump.get_kind_display(),
                    "unit": pump.unit_id,
                    "unit_name": pump.unit.name,
                    "is_active": pump.is_active,
                }
                for pump in pumps
            ]
        )


def _bunk_scope(request):
    user = request.user
    params = request.query_params
    chosen = pump_id(params)
    pumps = Pump.objects.select_related("unit")
    if user.role == Role.PUMP_OPERATOR:
        chosen = chosen or user.pump_id
        pumps = pumps.filter(pk=user.pump_id)
    elif user.role == Role.MTO:
        pumps = pumps.filter(unit=user.unit_id)
    if chosen is None:
        raise BusinessRuleError("Pick a bunk.")
    return get_object_or_404(pumps, pk=chosen), parse_period(params)
