from datetime import datetime
from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.utils import timezone

from common.months import IST
from fleet.models import FuelType
from fuel.models import EmergencyStatus, FuelGrant, FuelRequest, RequestStatus
from pumps.models import StockEntry, StockEntryKind
from testing.factories import (
    FuelGrantFactory,
    FuelRequestFactory,
    PumpStaffFactory,
    VehicleFactory,
    filled_request,
    police_pump,
)

pytestmark = pytest.mark.django_db


def test_request_statuses_and_their_labels():
    assert [(s.value, s.label) for s in RequestStatus] == [
        ("ISSUED", "PIN issued"),
        ("FILLED", "Filled"),
        ("CANCELLED", "Cancelled"),
        ("EXPIRED", "Expired"),
    ]


def test_emergency_statuses_and_their_labels():
    assert [(s.value, s.label) for s in EmergencyStatus] == [
        ("NONE", "Not an emergency"),
        ("PENDING", "Waiting for MTO"),
        ("ALLOWED", "Allowed — counted against additional quota"),
    ]


def test_a_new_request_starts_as_an_issued_ordinary_request_with_nothing_filled():
    request = FuelRequestFactory()
    request.refresh_from_db()

    assert request.status == RequestStatus.ISSUED
    assert request.is_emergency is False
    assert request.emergency_reason == ""
    assert request.failed_pin_attempts == 0
    assert request.cancel_reason == ""
    assert request.emergency_litres == Decimal("0")
    assert request.emergency_status == EmergencyStatus.NONE
    assert request.duty_particulars == ""
    assert request.duty_overdue_notified is False
    for empty in (
        "pump", "filled_by", "filled_at", "litres_filled", "stock_entry", "emergency_reviewed_by",
        "emergency_reviewed_at", "duty_submitted_at",
    ):
        assert getattr(request, empty) is None, empty
    assert request.issued_at is not None
    assert len(request.pin) == 6
    assert request.fuel_type == request.vehicle.fuel_type
    assert request.expires_at > request.issued_at


def test_the_factory_driver_belongs_to_the_vehicles_unit():
    request = FuelRequestFactory()

    assert request.driver.unit == request.vehicle.unit
    assert list(request.driver.fuel_requests.all()) == [request]
    assert list(request.vehicle.fuel_requests.all()) == [request]


def test_a_vehicle_can_have_only_one_open_request():
    vehicle = VehicleFactory()
    FuelRequestFactory(vehicle=vehicle)

    with pytest.raises(IntegrityError), transaction.atomic():
        FuelRequestFactory(vehicle=vehicle)


@pytest.mark.parametrize("closed", [RequestStatus.FILLED, RequestStatus.CANCELLED, RequestStatus.EXPIRED])
def test_closed_requests_do_not_block_a_new_one_and_other_vehicles_are_free(closed):
    vehicle = VehicleFactory()
    FuelRequestFactory(vehicle=vehicle, status=closed)
    FuelRequestFactory(vehicle=vehicle, status=closed)

    FuelRequestFactory(vehicle=vehicle)
    FuelRequestFactory()  # another vehicle

    assert FuelRequest.objects.filter(vehicle=vehicle, status=RequestStatus.ISSUED).count() == 1


def test_requests_are_listed_newest_first():
    older, newer = FuelRequestFactory(), FuelRequestFactory()

    assert list(FuelRequest.objects.all()) == [newer, older]


def test_filled_request_builds_a_filled_request():
    vehicle = VehicleFactory(fuel_type=FuelType.PETROL)
    filled_at = datetime(2026, 10, 3, 9, 15, tzinfo=IST)

    fill = filled_request(vehicle, Decimal("42.50"), filled_at)

    fill.refresh_from_db()
    assert fill.status == RequestStatus.FILLED
    assert fill.vehicle == vehicle
    assert fill.driver.unit == vehicle.unit
    assert fill.fuel_type == FuelType.PETROL
    assert fill.litres_requested == fill.litres_filled == Decimal("42.50")
    assert fill.filled_at == filled_at
    assert fill.pump is not None and fill.pump.unit == vehicle.unit
    assert fill.filled_by.pump == fill.pump
    assert fill.is_emergency is False
    assert (fill.emergency_litres, fill.emergency_status) == (Decimal("0"), EmergencyStatus.NONE)


def test_filled_request_uses_the_given_driver_and_pump_and_marks_an_emergency():
    vehicle = VehicleFactory()
    driver = FuelRequestFactory(vehicle=vehicle, status=RequestStatus.CANCELLED).driver
    pump = police_pump(vehicle.unit)

    fill = filled_request(
        vehicle, Decimal("15"), datetime(2026, 10, 3, tzinfo=IST), driver=driver, pump=pump,
        emergency_litres=Decimal("5"),
    )

    assert fill.driver == driver
    assert fill.pump == pump
    assert fill.is_emergency is True
    assert fill.emergency_reason
    assert fill.emergency_litres == Decimal("5")
    assert fill.emergency_status == EmergencyStatus.PENDING


def test_a_pump_lists_its_fills_and_a_stock_entry_belongs_to_one_request():
    vehicle = VehicleFactory()
    pump = police_pump(vehicle.unit, diesel=Decimal("500"))
    staff = PumpStaffFactory(pump=pump, unit=pump.unit)
    entry = StockEntry.objects.create(
        tank=pump.tanks.get(fuel_type=FuelType.DIESEL),
        kind=StockEntryKind.DISPENSE,
        litres=Decimal("20"),
        stock_before=Decimal("500"),
        stock_after=Decimal("480"),
        recorded_by=staff,
    )
    fill = filled_request(vehicle, Decimal("20"), datetime(2026, 10, 3, tzinfo=IST), pump=pump)
    fill.stock_entry = entry
    fill.save()

    assert list(pump.fills.all()) == [fill]
    assert entry.fuel_request == fill
    other = filled_request(vehicle, Decimal("5"), datetime(2026, 10, 4, tzinfo=IST), pump=pump)
    other.stock_entry = entry
    with pytest.raises(IntegrityError), transaction.atomic():
        other.save()


def test_a_vehicle_with_requests_or_grants_cannot_be_deleted():
    with_request = FuelRequestFactory().vehicle
    with_grant = FuelGrantFactory().vehicle

    with pytest.raises(ProtectedError):
        with_request.delete()
    with pytest.raises(ProtectedError):
        with_grant.delete()


def test_grants_are_listed_newest_first_and_letters_are_filed_by_year_and_month():
    older, newer = FuelGrantFactory(), FuelGrantFactory()

    assert list(FuelGrant.objects.all()) == [newer, older]
    year_month = timezone.localtime(older.created_at).strftime("letters/%Y/%m/")
    assert older.letter.name.startswith(year_month)
    assert older.letter.name.endswith(".pdf")
    assert older.note == ""


def test_the_grant_factory_uses_the_units_own_mto_for_every_grant():
    vehicle = VehicleFactory()

    first, second = FuelGrantFactory(vehicle=vehicle), FuelGrantFactory(vehicle=vehicle)

    assert first.created_by == second.created_by
    assert first.created_by.unit == vehicle.unit
