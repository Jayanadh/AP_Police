"""Officer transfers: the new MTO office asks, the officer's current (old) office decides.

On accept the officer moves to the new office and their old vehicle links end. A decision is
applied exactly once: the transfer row is locked and re-checked, and the officer row is locked
while it moves.
"""
from django.db import transaction
from django.utils import timezone

from accounts.models import OfficerTransfer, TransferStatus, Unit, User, UserStatus
from common.exceptions import BusinessRuleError
from fleet import services as fleet_services
from notifications.service import notify, unit_mtos

TRANSFERS_LINK = "/mto/transfers"
TRANSFERABLE_STATUSES = (UserStatus.ACTIVE, UserStatus.PAUSED)
NOT_TRANSFERABLE = "Only active or paused officers can be transferred."


def request_transfer(officer: User, requesting_unit: Unit, requested_by: User, note: str = "") -> OfficerTransfer:
    with transaction.atomic():
        # Lock the officer so two offices cannot both pass the checks below.
        locked = User.objects.select_for_update().get(pk=officer.pk)
        if locked.status not in TRANSFERABLE_STATUSES:
            raise BusinessRuleError(NOT_TRANSFERABLE)
        if locked.unit_id == requesting_unit.pk:
            raise BusinessRuleError("This officer is already in your MTO office.")
        if OfficerTransfer.objects.filter(officer=locked, status=TransferStatus.PENDING).exists():
            raise BusinessRuleError("This officer already has a pending transfer.")

        transfer = OfficerTransfer.objects.create(
            officer=locked,
            from_unit=locked.unit,
            to_unit=requesting_unit,
            note=note,
            requested_by=requested_by,
        )
        notify(
            unit_mtos(transfer.from_unit),
            f"Transfer request for {locked.full_name}",
            f"{requesting_unit.name} asks for {locked.full_name} ({locked.emp_id}).",
            TRANSFERS_LINK,
        )
    return transfer


def accept_transfer(transfer: OfficerTransfer, decided_by: User) -> OfficerTransfer:
    with transaction.atomic():
        locked = _lock_open_transfer(transfer, decided_by, by_old_office=True)
        officer = User.objects.select_for_update().get(pk=locked.officer_id)
        if officer.status not in TRANSFERABLE_STATUSES:
            raise BusinessRuleError(NOT_TRANSFERABLE)  # e.g. terminated while the request was waiting

        fleet_services.end_all_for_person(officer, ended_by=decided_by)
        officer.unit = locked.to_unit
        officer.save(update_fields=["unit"])
        _record_decision(locked, decided_by, TransferStatus.ACCEPTED)
        notify(unit_mtos(locked.to_unit), "Transfer accepted", _summary(locked), TRANSFERS_LINK)
    _copy_decision(locked, transfer)
    return locked


def close_transfer(transfer: OfficerTransfer, decided_by: User, status: str) -> OfficerTransfer:
    """Turn a pending transfer down (the old office: REJECTED) or take it back (the new office: CANCELLED)."""
    if status not in (TransferStatus.REJECTED, TransferStatus.CANCELLED):
        raise ValueError("A transfer is closed as REJECTED or CANCELLED; accept_transfer moves the officer.")
    rejecting = status == TransferStatus.REJECTED
    with transaction.atomic():
        locked = _lock_open_transfer(transfer, decided_by, by_old_office=rejecting)
        _record_decision(locked, decided_by, status)
        if rejecting:
            notify(unit_mtos(locked.to_unit), "Transfer rejected", _summary(locked), TRANSFERS_LINK)
    _copy_decision(locked, transfer)
    return locked


def _lock_open_transfer(transfer: OfficerTransfer, decided_by: User, by_old_office: bool) -> OfficerTransfer:
    """Re-read the transfer under a lock and check who may decide it, so a stale copy cannot be decided twice."""
    locked = (
        OfficerTransfer.objects.select_for_update(of=("self",))
        .select_related("officer", "from_unit", "to_unit")
        .get(pk=transfer.pk)
    )
    if by_old_office:
        if decided_by.unit_id != locked.from_unit_id:
            raise BusinessRuleError("Only the officer's current MTO office can accept or reject this transfer.")
    elif decided_by.unit_id != locked.to_unit_id:
        raise BusinessRuleError("Only the MTO office that sent this request can cancel it.")
    if locked.status != TransferStatus.PENDING:
        raise BusinessRuleError("This transfer has already been closed.")
    return locked


def _record_decision(transfer: OfficerTransfer, decided_by: User, status: str) -> None:
    transfer.status = status
    transfer.decided_by = decided_by
    transfer.decided_at = timezone.now()
    transfer.save(update_fields=["status", "decided_by", "decided_at"])


def _copy_decision(source: OfficerTransfer, target: OfficerTransfer) -> None:
    for field in ("status", "decided_by", "decided_at"):
        setattr(target, field, getattr(source, field))


def _summary(transfer: OfficerTransfer) -> str:
    return f"{transfer.officer.full_name} ({transfer.officer.emp_id}) — {transfer.from_unit.name}"
