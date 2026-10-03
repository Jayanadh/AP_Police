from django.utils import timezone
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role
from accounts.permissions import role_required
from common.excel import xlsx_response
from common.months import current_month, today_ist
from dashboards import monitoring, summaries
from fuel.quota import quotas_for


class DashboardView(APIView):
    """The caller's own dashboard: the summary for their role, as of now. Any logged-in user may read theirs."""

    def get(self, request):
        return Response(summaries.dashboard_for(request.user, timezone.now()))


class MonitorVehiclesView(generics.ListAPIView):
    """Every office's vehicles for the PTO, read only: who drives them, this month's fuel, the last odometer reading
    and whether a service is due."""

    permission_classes = [role_required(Role.PTO)]
    pagination_class = monitoring.MonitorPagination
    serializer_class = monitoring.MonitorVehicleSerializer

    def get_queryset(self):
        return monitoring.vehicles(self.request.query_params)

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        context = {"quotas": quotas_for(page, current_month()), "today": today_ist()}
        return self.get_paginated_response(self.get_serializer(page, many=True, context=context).data)

    def get_serializer(self, *args, **kwargs):
        context = kwargs.pop("context", {})
        return self.serializer_class(*args, context={**self.get_serializer_context(), **context}, **kwargs)


class MonitorPeopleView(generics.ListAPIView):
    """Every office's officers or drivers (set `person_role`) for the PTO, read only."""

    permission_classes = [role_required(Role.PTO)]
    pagination_class = monitoring.MonitorPagination
    person_role = ""  # set in the URL: Role.OFFICER or Role.DRIVER

    def get_serializer_class(self):
        if self.person_role == Role.DRIVER:
            return monitoring.MonitorDriverSerializer
        return monitoring.MonitorPersonSerializer

    def get_queryset(self):
        return monitoring.people(self.person_role, self.request.query_params)


class MonitorVehiclesExportView(APIView):
    """The vehicles list as an Excel file: every vehicle the filters find, not one page."""

    permission_classes = [role_required(Role.PTO)]

    def get(self, request):
        return xlsx_response("vehicles.xlsx", [monitoring.vehicles_sheet(request.query_params, today_ist())])


class MonitorPeopleExportView(APIView):
    """The officers or drivers list (set `person_role`) as an Excel file: everyone the filters find, not one page."""

    permission_classes = [role_required(Role.PTO)]
    person_role = ""  # set in the URL: Role.OFFICER or Role.DRIVER

    def get(self, request):
        sheet = monitoring.people_sheet(self.person_role, request.query_params)
        return xlsx_response(f"{sheet.title.lower()}.xlsx", [sheet])
