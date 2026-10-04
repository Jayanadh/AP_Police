from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Prefetch, Q
from django.http import Http404
from rest_framework import generics, mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.models import Role
from accounts.permissions import role_required
from accounts.views.people import PersonViewSet
from common.months import month_bounds, parse_month
from common.periods import parse_period
from fleet.models import FuelType
from pumps import exports, services, stock
from pumps.models import Pump, PumpKind, PumpTank, StockEntry
from pumps.serializers import (
    FORMER_STAFF,
    DirectoryPumpSerializer,
    PumpSerializer,
    PumpStaffSerializer,
    StockEntrySerializer,
    StockInputSerializer,
    TankDetailSerializer,
)


def _has_entries() -> Exists:
    """Whether anything was recorded for the tank yet, as a column: once it has, its opening stock is set."""
    return Exists(StockEntry.objects.filter(tank=OuterRef("pk")))


class PumpViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """The MTO's own pumps. Another office's pumps are invisible (404)."""

    serializer_class = PumpSerializer
    permission_classes = [role_required(Role.MTO)]
    http_method_names = ["get", "post", "patch"]

    def get_queryset(self):
        return (
            Pump.objects.filter(unit=self.request.user.unit)
            .select_related("district")
            .prefetch_related(Prefetch("tanks", queryset=PumpTank.objects.annotate(opening_set=_has_entries())))
            .annotate(staff_count=Count("staff", filter=~Q(staff__status__in=FORMER_STAFF)))
        )

    def perform_create(self, serializer):
        unit = self.request.user.unit
        serializer.instance = services.create_pump(unit, district=unit.district, **serializer.validated_data)

    @transaction.atomic
    def perform_update(self, serializer):
        services.ensure_tanks(serializer.save())  # enabling a fuel (or switching kind) may need a new tank

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        return self._set_active(self.get_object(), True)

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        return self._set_active(self.get_object(), False)

    def _set_active(self, pump, active):
        pump.is_active = active
        pump.save(update_fields=["is_active"])
        return Response(self.get_serializer(pump).data)


class PumpStaffViewSet(PersonViewSet):
    """Logins for the staff of the MTO's own pumps and tie-up bunks."""

    serializer_class = PumpStaffSerializer
    person_role = Role.PUMP_OPERATOR

    def get_queryset(self):
        return super().get_queryset().select_related("pump")


class TankViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Police pump tanks. The MTO sees the tanks of their unit's pumps, sets each one's opening stock once and its
    alert level; pump staff record tanker receipts at their own pump. Anyone else's tank is invisible (404)."""

    serializer_class = TankDetailSerializer
    http_method_names = ["get", "post", "patch"]

    def get_permissions(self):
        if self.action in ("partial_update", "opening"):
            roles = (Role.MTO,)
        elif self.action in ("receive", "entries_export"):
            roles = (Role.PUMP_OPERATOR,)
        else:
            roles = (Role.MTO, Role.PUMP_OPERATOR)
        return [role_required(*roles)()]

    def get_queryset(self):
        user = self.request.user
        tanks = (
            stock.police_tanks()
            .select_related("pump")
            .annotate(opening_set=_has_entries())
            .order_by("pump_id", "id")
        )
        if user.role == Role.PUMP_OPERATOR:
            return tanks.filter(pump=user.pump_id)
        return tanks.filter(pump__unit=user.unit)

    def perform_update(self, serializer):
        # Not serializer.save(): the levels are written under the tank lock, with the alert re-checked.
        stock.update_levels(serializer.instance, **serializer.validated_data)

    @action(detail=True, methods=["post"])
    def opening(self, request, pk=None):
        return self._record(stock.record_opening)

    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        return self._record(stock.record_receipt)

    def _record(self, record):
        tank = self.get_object()
        entry = StockInputSerializer(data=self.request.data)
        entry.is_valid(raise_exception=True)
        record(tank, entry.validated_data["litres"], self.request.user, entry.validated_data["note"])
        return Response(self.get_serializer(self.get_queryset().get(pk=tank.pk)).data)

    @action(detail=True, methods=["get"])
    def entries(self, request, pk=None):
        """The tank's stock entries, newest first: of a period (`?from=&to=`) or of a month (`?month=YYYY-MM`, this
        month when neither is given)."""
        tank = self.get_object()
        params = request.query_params
        if "from" in params or "to" in params:
            start, end = parse_period(params).bounds()
        else:
            start, end = month_bounds(parse_month(params.get("month")))
        rows = tank.entries.filter(recorded_at__gte=start, recorded_at__lt=end).select_related("recorded_by")
        return Response(StockEntrySerializer(rows, many=True).data)

    @action(detail=False, methods=["get"], url_path="entries/export")
    def entries_export(self, request):
        """The stock entries of the staff's own pump in a period (`?from=&to=`, this month when not given), as
        Excel."""
        tanks = list(self.get_queryset())
        if not tanks:
            raise Http404("This pump keeps no stock.")
        return exports.stock_entries(tanks[0].pump, tanks, parse_period(request.query_params))


class PumpDirectoryView(generics.ListAPIView):
    """Every active pump in AP, for any logged-in user: where to fill up, and what is in stock. `?fuel=` keeps the
    pumps that can fill that fuel now."""

    serializer_class = DirectoryPumpSerializer
    pagination_class = None

    def get_queryset(self):
        pumps = Pump.objects.filter(is_active=True).select_related("district", "unit").prefetch_related("tanks")
        params = self.request.query_params
        if search := params.get("search"):
            pumps = pumps.filter(
                Q(name__icontains=search) | Q(address__icontains=search) | Q(district__name__icontains=search)
            )
        fuel = params.get("fuel", "").upper()
        if fuel in (FuelType.PETROL, FuelType.DIESEL):
            # The pumps that can fill that fuel now: a bunk that sells it, a police pump that has some in stock.
            sells = Q(sells_petrol=True) if fuel == FuelType.PETROL else Q(sells_diesel=True)
            in_stock = Exists(PumpTank.objects.filter(pump=OuterRef("pk"), fuel_type=fuel, current_stock_litres__gt=0))
            pumps = pumps.filter(sells).filter(Q(kind=PumpKind.TIE_UP) | in_stock)
        return pumps
