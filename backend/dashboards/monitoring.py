"""The PTO's read-only view of every office: its vehicles, officers and drivers, with what monitoring needs, fifty to a
page. Nothing here changes anything; the MTO of each office does that."""
from datetime import date
from decimal import Decimal

from django.db.models import Count, IntegerField, OuterRef, Prefetch, Q, QuerySet, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from accounts.models import Role, User
from common.excel import Sheet
from accounts.serializers.people import current_vehicle_links
from common.months import current_month, month_bounds
from common.params import office_id
from fleet import services
from fleet.models import AssignmentKind, FuelType, OdometerReading, ServiceRecord, Vehicle, normalize_registration
from fleet.servicing import SERVICED_STATUSES, status_from
from fuel.models import FuelRequest, RequestStatus
from fuel.quota import fmt, quotas_for
from fuel.requests import overdue_duty

PAGE_SIZE = 50


class MonitorPagination(PageNumberPagination):
    page_size = PAGE_SIZE

    def get_paginated_response(self, data):
        return Response(
            {
                "count": self.page.paginator.count,
                "page": self.page.number,
                "pages": self.page.paginator.num_pages,
                "page_size": self.page_size,
                "results": data,
            }
        )


def _unit_filter(rows: QuerySet, params, field: str) -> QuerySet:
    if (unit := office_id(params)) is not None:
        rows = rows.filter(**{field: unit})
    return rows


# --- vehicles --------------------------------------------------------------------------------------------------


def vehicles(params) -> QuerySet[Vehicle]:
    """Every office's vehicles by office and registration, each with its newest Sunday reading and newest service.
    `unit`, `status` and `search` (part of the registration) narrow the list."""
    newest_reading = OdometerReading.objects.filter(vehicle=OuterRef("pk")).order_by("-week_of", "-id")
    newest_service = ServiceRecord.objects.filter(vehicle=OuterRef("pk")).order_by("-service_date", "-id")
    rows = (
        Vehicle.objects.select_related("unit")
        .prefetch_related(services.current_links_prefetch())
        .annotate(
            reading_km=Subquery(newest_reading.values("reading_km")[:1]),
            reading_week=Subquery(newest_reading.values("week_of")[:1]),
            serviced_on=Subquery(newest_service.values("service_date")[:1]),
            serviced_at_km=Subquery(newest_service.values("odometer_km")[:1]),
        )
        .order_by("unit__name", "registration_number")
    )
    rows = _unit_filter(rows, params, "unit")
    if status := params.get("status"):
        rows = rows.filter(status=status)
    if search := params.get("search"):
        rows = rows.filter(registration_number__contains=normalize_registration(search))
    return rows


class MonitorVehicleSerializer(serializers.ModelSerializer):
    """A vehicle as the PTO watches it. The context carries `quotas` (this month's, by vehicle id) and `today`."""

    unit_name = serializers.CharField(source="unit.name")
    status_label = serializers.CharField(source="get_status_display")
    driver = serializers.SerializerMethodField()
    officer = serializers.SerializerMethodField()
    limit_litres = serializers.SerializerMethodField()
    used_litres = serializers.SerializerMethodField()
    remaining_litres = serializers.SerializerMethodField()
    last_odometer_km = serializers.IntegerField(source="reading_km", allow_null=True)
    last_odometer_week = serializers.DateField(source="reading_week", allow_null=True)
    service_due = serializers.SerializerMethodField()

    class Meta:
        model = Vehicle
        fields = [
            "id", "registration_number", "vehicle_type", "make", "model", "fuel_type", "unit", "unit_name", "status",
            "status_label", "driver", "officer", "limit_litres", "used_litres", "remaining_litres",
            "last_odometer_km", "last_odometer_week", "service_due",
        ]
        read_only_fields = fields

    def _person(self, vehicle, kind):
        for link in vehicle.current_links:  # set by current_links_prefetch()
            if link.kind == kind:
                person = link.person
                return {
                    "id": person.id, "full_name": person.full_name, "emp_id": person.emp_id, "mobile": person.mobile,
                }
        return None

    def get_driver(self, vehicle):
        return self._person(vehicle, AssignmentKind.DRIVER)

    def get_officer(self, vehicle):
        return self._person(vehicle, AssignmentKind.OFFICER)

    def get_limit_litres(self, vehicle):
        return fmt(self.context["quotas"][vehicle.pk].limit_litres)

    def get_used_litres(self, vehicle):
        return fmt(self.context["quotas"][vehicle.pk].used_litres)

    def get_remaining_litres(self, vehicle):
        return fmt(self.context["quotas"][vehicle.pk].remaining_litres)

    def get_service_due(self, vehicle) -> bool:
        if vehicle.status not in SERVICED_STATUSES:
            return False
        latest_km = max(vehicle.odometer_at_onboarding_km, vehicle.reading_km or 0, vehicle.serviced_at_km or 0)
        today: date = self.context["today"]
        return status_from(vehicle, vehicle.serviced_on, vehicle.serviced_at_km, latest_km, today)["due"]


# --- officers and drivers --------------------------------------------------------------------------------------


def people(role: str, params) -> QuerySet[User]:
    """Every office's officers or drivers by office and name, with the vehicles linked to them now. Drivers also
    carry this month's fills and how many of their fills still wait for duty particulars past the 48 hours.
    `unit`, `status` and `search` (part of the name or Emp ID) narrow the list."""
    rows = (
        User.objects.filter(role=role)
        .select_related("unit", "designation")
        .prefetch_related(
            Prefetch("vehicle_assignments", queryset=current_vehicle_links(), to_attr="current_links")
        )
        .order_by("unit__name", "full_name", "id")
    )
    if role == Role.DRIVER:
        rows = _with_driver_figures(rows)
    rows = _unit_filter(rows, params, "unit")
    if status := params.get("status"):
        rows = rows.filter(status=status)
    if search := params.get("search"):
        rows = rows.filter(Q(full_name__icontains=search) | Q(emp_id__icontains=search))
    return rows


def _with_driver_figures(rows: QuerySet[User]) -> QuerySet[User]:
    start, end = month_bounds(current_month())
    month_fills = FuelRequest.objects.filter(
        driver=OuterRef("pk"), status=RequestStatus.FILLED, filled_at__gte=start, filled_at__lt=end
    ).order_by()
    overdue = overdue_duty(timezone.now()).filter(driver=OuterRef("pk")).order_by()
    zero = Value(0, output_field=IntegerField())
    return rows.annotate(
        fills_this_month=Coalesce(Subquery(month_fills.values("driver").annotate(n=Count("id")).values("n")), zero),
        litres_this_month=Subquery(month_fills.values("driver").annotate(n=Sum("litres_filled")).values("n")),
        overdue_duty=Coalesce(Subquery(overdue.values("driver").annotate(n=Count("id")).values("n")), zero),
    )


class MonitorPersonSerializer(serializers.ModelSerializer):
    """An officer or a driver as the PTO watches them."""

    designation_name = serializers.CharField(source="designation.name", default=None)
    unit_name = serializers.CharField(source="unit.name", default=None)
    status_label = serializers.CharField(source="get_status_display")
    current_vehicles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "full_name", "emp_id", "designation_name", "unit", "unit_name", "status", "status_label", "mobile",
            "current_vehicles",
        ]
        read_only_fields = fields

    def get_current_vehicles(self, person):
        return [
            {"id": link.vehicle.id, "registration_number": link.vehicle.registration_number}
            for link in person.current_links
        ]


class MonitorDriverSerializer(MonitorPersonSerializer):
    litres_this_month = serializers.SerializerMethodField()
    fills_this_month = serializers.IntegerField()
    overdue_duty = serializers.IntegerField()

    class Meta(MonitorPersonSerializer.Meta):
        fields = [
            *MonitorPersonSerializer.Meta.fields, "licence_number", "licence_valid_till", "fills_this_month",
            "litres_this_month", "overdue_duty",
        ]
        read_only_fields = fields

    def get_litres_this_month(self, driver):
        return fmt(driver.litres_this_month or 0)


# --- the same lists as Excel sheets ----------------------------------------------------------------------------


def vehicles_sheet(params, today: date) -> Sheet:
    """Every vehicle `vehicles(params)` finds, not a page of them."""
    rows = list(vehicles(params))
    serializer = MonitorVehicleSerializer(
        rows, many=True, context={"quotas": quotas_for(rows, current_month()), "today": today}
    )
    return Sheet(
        "Vehicles",
        [
            "Registration", "Vehicle", "Fuel", "Office", "Status", "Driver", "Officer", "Limit (L)", "Used (L)",
            "Left (L)", "Last odometer (km)", "Service due",
        ],
        [
            [
                row["registration_number"], f"{row['make']} {row['model']}".strip(), FuelType(row["fuel_type"]).label,
                row["unit_name"], row["status_label"], _name(row["driver"]), _name(row["officer"]),
                Decimal(row["limit_litres"]), Decimal(row["used_litres"]), Decimal(row["remaining_litres"]),
                row["last_odometer_km"], "Yes" if row["service_due"] else "No",
            ]
            for row in serializer.data
        ],
    )


def people_sheet(role: str, params) -> Sheet:
    """Every officer or driver `people(role, params)` finds, not a page of them."""
    headers = ["Name", "Emp ID", "Designation", "Office", "Status", "Mobile", "Vehicles"]
    if role == Role.DRIVER:
        headers += [
            "Licence", "Licence valid till", "Fills this month", "Litres this month", "Overdue duty particulars",
        ]
    rows = []
    for person in people(role, params):
        row = [
            person.full_name, person.emp_id or "", person.designation.name if person.designation else "",
            person.unit.name if person.unit else "", person.get_status_display(), person.mobile,
            ", ".join(link.vehicle.registration_number for link in person.current_links),
        ]
        if role == Role.DRIVER:
            row += [
                person.licence_number, person.licence_valid_till, person.fills_this_month,
                person.litres_this_month or Decimal("0"), person.overdue_duty,
            ]
        rows.append(row)
    return Sheet("Drivers" if role == Role.DRIVER else "Officers", headers, rows)


def _name(person: dict | None) -> str:
    return person["full_name"] if person else ""
