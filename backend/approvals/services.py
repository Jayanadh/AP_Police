"""PTO approvals: a new officer, or the termination of a vehicle.

An MTO asks, the PTO decides. The request and the thing it is about change together in one
transaction, and a decision is applied exactly once: the request row is locked and re-checked.
"""
from django.db import transaction
from django.utils import timezone

from accounts.models import User, UserStatus
from approvals.models import ApprovalKind, ApprovalRequest, ApprovalStatus
from common.exceptions import BusinessRuleError
from fleet import services as fleet_services
from fleet.models import Vehicle, VehicleStatus
from notifications.service import notify, ptos, unit_mtos

APPROVALS_LINK = "/pto/approvals"
TERMINABLE_STATUSES = (VehicleStatus.ACTIVE, VehicleStatus.PAUSED)


def request_officer_approval(officer: User, requested_by: User, note: str = "") -> ApprovalRequest:
    with transaction.atomic():
        approval = ApprovalRequest.objects.create(
            kind=ApprovalKind.OFFICER_CREATE,
            unit=officer.unit,
            officer=officer,
            request_note=note,
            requested_by=requested_by,
        )
        notify(
            ptos(),
            "New officer waiting for approval",
            f"{officer.full_name} ({officer.emp_id}) — {officer.unit.name}",
            APPROVALS_LINK,
        )
    return approval


def request_vehicle_termination(vehicle: Vehicle, requested_by: User, note: str) -> ApprovalRequest:
    with transaction.atomic():
        # Lock the vehicle so two requests (or a pause) cannot both pass the status check.
        locked = Vehicle.objects.select_for_update().select_related("unit").get(pk=vehicle.pk)
        if locked.status not in TERMINABLE_STATUSES:
            raise BusinessRuleError("Only active or paused vehicles can be sent for termination.")

        approval = ApprovalRequest.objects.create(
            kind=ApprovalKind.VEHICLE_TERMINATE,
            unit=locked.unit,
            vehicle=locked,
            previous_status=locked.status,
            request_note=note,
            requested_by=requested_by,
        )
        locked.status = VehicleStatus.TERMINATION_PENDING
        locked.save(update_fields=["status", "updated_at"])
        notify(
            ptos(),
            "Vehicle termination waiting for approval",
            f"{locked.registration_number} — {locked.unit.name}: {note}",
            APPROVALS_LINK,
        )
    vehicle.status = locked.status
    return approval


def decide(approval: ApprovalRequest, decided_by: User, approve: bool, note: str = "") -> ApprovalRequest:
    with transaction.atomic():
        # Re-read under a lock so a stale in-memory request cannot be decided twice.
        locked = ApprovalRequest.objects.select_for_update().get(pk=approval.pk)
        if locked.status != ApprovalStatus.PENDING:
            raise BusinessRuleError("This request has already been decided.")

        locked.status = ApprovalStatus.APPROVED if approve else ApprovalStatus.REJECTED
        locked.decided_by = decided_by
        locked.decided_at = timezone.now()
        locked.decision_note = note
        locked.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])

        if locked.kind == ApprovalKind.OFFICER_CREATE:
            _apply_officer_decision(locked, approve)
        else:
            _apply_termination_decision(locked, decided_by, approve)

    for field in ("status", "decided_by", "decided_at", "decision_note"):
        setattr(approval, field, getattr(locked, field))
    return locked


def _apply_officer_decision(approval: ApprovalRequest, approve: bool) -> None:
    officer = approval.officer
    officer.status = UserStatus.ACTIVE if approve else UserStatus.REJECTED
    officer.save(update_fields=["status"])  # User.save keeps is_active in step with status
    _tell_the_mto(
        approval,
        "Officer approved" if approve else "Officer rejected",
        f"{officer.full_name} ({officer.emp_id})",
        "/mto/officers",
    )


def _apply_termination_decision(approval: ApprovalRequest, decided_by: User, approve: bool) -> None:
    vehicle = Vehicle.objects.select_for_update().get(pk=approval.vehicle_id)
    if approve:
        vehicle.status = VehicleStatus.TERMINATED
        fleet_services.end_all_for_vehicle(vehicle, decided_by)
    else:
        vehicle.status = approval.previous_status
    vehicle.save(update_fields=["status", "updated_at"])
    _tell_the_mto(
        approval,
        "Vehicle termination approved" if approve else "Vehicle termination rejected",
        vehicle.registration_number,
        f"/mto/vehicles/{vehicle.id}",
    )


def _tell_the_mto(approval: ApprovalRequest, title: str, subject: str, link: str) -> None:
    body = f"{subject}: {approval.decision_note}" if approval.decision_note else subject
    notify(unit_mtos(approval.unit), title, body, link)
