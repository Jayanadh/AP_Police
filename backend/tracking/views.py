from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.models import Role
from accounts.permissions import role_required
from common.params import after_id
from tracking import services
from tracking.serializers import (
    PathPointSerializer,
    PointBatchSerializer,
    TripSerializer,
    TripStartSerializer,
    board_row,
)

# The most locations one answer of a trip's route carries; the map asks again with the cursor for the rest.
PATH_PAGE = 2000


class TripViewSet(viewsets.GenericViewSet):
    """The driver's duty trips: start one, send its locations, stop it. The route is also open to the MTO of the
    vehicle's office. A trip anyone else asks for is invisible (404)."""

    serializer_class = TripSerializer
    throttle_scope = "location"  # used by the one throttled action, the location batches

    def get_permissions(self):
        if self.action == "path":
            return [role_required(Role.DRIVER, Role.MTO)()]
        return [role_required(Role.DRIVER)()]

    def get_queryset(self):
        return services.trips_visible_to(self.request.user).select_related("driver", "vehicle")

    def create(self, request):
        serializer = TripStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        trip = services.start_trip(request.user, serializer.validated_data["duty_particulars"])
        return Response(TripSerializer(trip).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def current(self, request):
        """The driver's trip still open, if any: the app picks sharing up again after a reload."""
        trip = self.get_queryset().filter(ended_at__isnull=True).first()
        return Response({"trip": trip and TripSerializer(trip).data})

    @action(detail=True, methods=["post"], throttle_classes=[ScopedRateThrottle])
    def points(self, request, pk=None):
        """A batch of locations, each with the phone's own time, so one kept while offline still lands in place."""
        trip = self.get_object()
        serializer = PointBatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        accepted = services.record_points(trip, serializer.validated_data["points"])
        return Response({"accepted": accepted, "trip": TripSerializer(trip).data})

    @action(detail=True, methods=["post"])
    def stop(self, request, pk=None):
        return Response(TripSerializer(services.stop_trip(self.get_object())).data)

    @action(detail=True, methods=["get"])
    def path(self, request, pk=None):
        """The trip's route, oldest first. `?after=<cursor>` gives only the locations kept since that answer (a batch
        sent late included), so a map can keep asking for what is new."""
        trip = self.get_object()
        after = after_id(request.query_params)
        page = list(
            trip.points.filter(pk__gt=after).order_by("pk").only("pk", "latitude", "longitude", "recorded_at")[
                : PATH_PAGE + 1
            ]
        )
        more = len(page) > PATH_PAGE
        page = page[:PATH_PAGE]
        return Response(
            {
                "trip": TripSerializer(trip).data,
                "points": PathPointSerializer(sorted(page, key=lambda point: point.recorded_at), many=True).data,
                "cursor": page[-1].pk if page else after,
                "more": more,
            }
        )


class LiveBoardView(APIView):
    """GET: every driver of the MTO's office, the vehicle they drive, and where it is if they are sharing."""

    permission_classes = [role_required(Role.MTO)]

    def get(self, request):
        return Response([board_row(row) for row in services.live_board(request.user)])
