"""Vehicle <-> officer/driver links.

A vehicle has at most one current officer and one current driver. An officer may be on
several vehicles; a driver is on one vehicle at a time. A link is current while `ended_at`
is empty; ending a link keeps the row as history.
"""
from django.db import transaction
from django.db.models import Prefetch, QuerySet
from django.utils import timezone

from accounts.models import Role, User, UserStatus
from common.exceptions import BusinessRuleError
from fleet.models import AssignmentKind, Vehicle, VehicleAssignment, VehicleStatus

LINKABLE_VEHICLE_STATUSES = (VehicleStatus.ACTIVE, VehicleStatus.PAUSED)
KIND_BY_ROLE = {Role.OFFICER: AssignmentKind.OFFICER, Role.DRIVER: AssignmentKind.DRIVER}


def current_links(vehicle: Vehicle) -> QuerySet[VehicleAssignment]:
    return vehicle.assignments.filter(ended_at__isnull=True).select_related("person")


def current_links_prefetch() -> Prefetch:
    """Loads each vehicle's open links (with the person) into `vehicle.current_links` in one query."""
    return Prefetch(
        "assignments",
        queryset=VehicleAssignment.objects.filter(ended_at__isnull=True).select_related("person"),
        to_attr="current_links",
    )


def assign_person(vehicle: Vehicle, person: User, assigned_by: User) -> VehicleAssignment:
    with transaction.atomic():
        # Lock the vehicle (and the person) so two requests cannot both pass the checks below.
        vehicle = Vehicle.objects.select_for_update().get(pk=vehicle.pk)
        person = User.objects.select_for_update().get(pk=person.pk)

        if vehicle.status not in LINKABLE_VEHICLE_STATUSES:
            raise BusinessRuleError("Only active or paused vehicles can be linked.")
        if person.role not in KIND_BY_ROLE:
            raise BusinessRuleError("Only officers and drivers can be linked to vehicles.")
        if person.unit_id != vehicle.unit_id:
            raise BusinessRuleError("This person belongs to a different MTO office.")
        if person.status != UserStatus.ACTIVE:
            raise BusinessRuleError("Only active officers and drivers can be linked.")

        kind = KIND_BY_ROLE[person.role]
        if kind == AssignmentKind.OFFICER:
            if current_links(vehicle).filter(kind=AssignmentKind.OFFICER).exists():
                raise BusinessRuleError("This vehicle already has an officer. End that link first.")
        else:
            if current_links(vehicle).filter(kind=AssignmentKind.DRIVER).exists():
                raise BusinessRuleError("This vehicle already has a driver. End that link first.")
            if person.vehicle_assignments.filter(kind=AssignmentKind.DRIVER, ended_at__isnull=True).exists():
                raise BusinessRuleError("This driver is already linked to another vehicle.")

        return VehicleAssignment.objects.create(
            vehicle=vehicle, person=person, kind=kind, assigned_by=assigned_by
        )


def end_assignment(link: VehicleAssignment, ended_by: User) -> VehicleAssignment:
    with transaction.atomic():
        # Re-read under a lock so a stale in-memory link cannot be ended twice.
        locked = VehicleAssignment.objects.select_for_update().get(pk=link.pk)
        if locked.ended_at is not None:
            raise BusinessRuleError("This link has already ended.")
        locked.ended_at = timezone.now()
        locked.ended_by = ended_by
        locked.save(update_fields=["ended_at", "ended_by"])
    link.ended_at, link.ended_by = locked.ended_at, locked.ended_by
    return locked


def end_all_for_person(person: User, ended_by: User) -> int:
    return _end_open(VehicleAssignment.objects.filter(person=person), ended_by)


def end_all_for_vehicle(vehicle: Vehicle, ended_by: User) -> int:
    return _end_open(VehicleAssignment.objects.filter(vehicle=vehicle), ended_by)


def _end_open(links: QuerySet[VehicleAssignment], ended_by: User) -> int:
    return links.filter(ended_at__isnull=True).update(ended_at=timezone.now(), ended_by=ended_by)


def current_vehicle_for(person: User) -> Vehicle | None:
    """A driver's current vehicle; for an officer, the vehicle they have been linked to longest."""
    link = (
        VehicleAssignment.objects.filter(person=person, ended_at__isnull=True)
        .select_related("vehicle")
        .order_by("started_at", "id")
        .first()
    )
    return link.vehicle if link else None


def vehicles_visible_to(user: User) -> QuerySet[Vehicle]:
    """The vehicles a user may read: all of them (PTO), their unit's (MTO), or the ones they are linked to now
    (officer, driver)."""
    vehicles = Vehicle.objects.all()
    if user.role == Role.PTO:
        return vehicles
    if user.role == Role.MTO:
        return vehicles.filter(unit=user.unit_id)
    if user.role in KIND_BY_ROLE:
        return vehicles.filter(assignments__person=user, assignments__ended_at__isnull=True)
    return vehicles.none()
