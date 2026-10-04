from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.exceptions import NotFound

from accounts.models import UserStatus
from common.exceptions import BusinessRuleError
from fleet import services
from fleet.models import FuelType, VehicleStatus
from fuel import redeem
from fuel.models import EmergencyStatus, RequestStatus
from notifications.models import Notification
from pumps.models import PumpKind, StockEntryKind
from testing.factories import (
    DriverFactory,
    FuelRequestFactory,
    MTOFactory,
    PumpFactory,
    PumpStaffFactory,
    UnitFactory,
    VehicleFactory,
    filled_request,
    police_pump,
    tieup_pump,
)

pytestmark = pytest.mark.django_db

PIN = "123456"
NOT_OPEN = "This request is no longer open."
EXPIRED = "This PIN has expired. The driver must raise a new request."
NOT_ACTIVE = "This vehicle is paused or terminated."


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def vehicle(mto):
    return VehicleFactory(
        unit=mto.unit,
        registration_number="AP39PA1234",
        fuel_type=FuelType.DIESEL,
        tank_capacity_litres=Decimal("60"),
        monthly_fuel_limit_litres=Decimal("100"),
    )


@pytest.fixture
def driver(mto, vehicle):
    person = DriverFactory(unit=mto.unit)
    services.assign_person(vehicle, person, mto)
    return person


@pytest.fixture
def bunk():
    """A tie-up bunk of some other unit than the vehicle's."""
    return tieup_pump(UnitFactory())


@pytest.fixture
def operator(bunk):
    return PumpStaffFactory(pump=bunk, unit=bunk.unit)


@pytest.fixture
def open_request(vehicle, driver, bunk):
    """A diesel request for 20 L at the bunk, with the PIN 123456."""
    return FuelRequestFactory(vehicle=vehicle, driver=driver, pump=bunk, litres_requested=Decimal("20"), pin=PIN)


def ask(vehicle, driver, pump, litres, **extra):
    return FuelRequestFactory(
        vehicle=vehicle, driver=driver, pump=pump, litres_requested=Decimal(litres), pin=PIN, **extra
    )


def fill(operator, request, pin=PIN):
    return redeem.fill(operator=operator, request_id=request.pk, pin=pin)


def refusal(operator, request, pin=PIN, step=redeem.fill) -> str:
    with pytest.raises(BusinessRuleError) as error:
        step(operator=operator, request_id=request.pk, pin=pin)
    return str(error.value.detail)


def stored(fuel_request):
    fuel_request.refresh_from_db()
    return fuel_request


def stock_of(pump, fuel_type=FuelType.DIESEL):
    return pump.tanks.get(fuel_type=fuel_type).current_stock_litres


def use_up_the_month(vehicle, litres="90"):
    """Fills made earlier this month, leaving `100 - litres` L of the normal quota."""
    filled_request(vehicle, Decimal(litres), timezone.now())


# --- the incoming list -------------------------------------------------------------------------


def test_the_incoming_list_holds_the_open_requests_for_this_pump_oldest_first(operator, bunk, vehicle, driver):
    first = ask(vehicle, driver, bunk, "20")
    other_vehicle = VehicleFactory(unit=vehicle.unit)
    other_driver = DriverFactory(unit=vehicle.unit)
    second = ask(other_vehicle, other_driver, bunk, "15")
    ask(VehicleFactory(unit=vehicle.unit), DriverFactory(unit=vehicle.unit), tieup_pump(UnitFactory()), "10")
    ask(VehicleFactory(unit=vehicle.unit), DriverFactory(unit=vehicle.unit), bunk, "5", status=RequestStatus.FILLED)

    assert list(redeem.incoming(operator)) == [first, second]


def test_a_request_whose_pin_ran_out_leaves_the_incoming_list_as_expired(operator, open_request):
    open_request.expires_at = timezone.now() - timedelta(minutes=1)
    open_request.save()

    assert list(redeem.incoming(operator)) == []
    assert stored(open_request).status == RequestStatus.EXPIRED


def test_staff_of_a_closed_pump_have_no_incoming_requests(operator, bunk, open_request):
    bunk.is_active = False
    bunk.save()

    assert list(redeem.incoming(operator)) == []


# --- checking the PIN --------------------------------------------------------------------------


def test_the_right_pin_shows_the_request_and_changes_nothing(operator, open_request):
    checked = redeem.check_pin(operator=operator, request_id=open_request.pk, pin=PIN)

    assert checked.pk == open_request.pk
    assert checked.litres_requested == Decimal("20")
    after = stored(open_request)
    assert (after.status, after.failed_pin_attempts) == (RequestStatus.ISSUED, 0)
    assert not Notification.objects.exists()


def test_a_wrong_pin_at_the_check_counts_like_any_other(operator, open_request):
    assert refusal(operator, open_request, pin="000000", step=redeem.check_pin) == "Wrong PIN. 4 attempt(s) left."
    assert stored(open_request).failed_pin_attempts == 1


def test_the_check_warns_when_a_police_pump_cannot_cover_the_litres(vehicle, driver):
    pump = police_pump(UnitFactory(), diesel=Decimal("12"))
    request = ask(vehicle, driver, pump, "20")

    message = refusal(PumpStaffFactory(pump=pump, unit=pump.unit), request, step=redeem.check_pin)

    assert message == "Only 12.00 L of diesel in stock."


# --- a successful fill -------------------------------------------------------------------------


def test_the_right_pin_at_a_tie_up_bunk_fills_exactly_the_litres_asked_for(operator, bunk, open_request):
    before = timezone.now()

    filled = fill(operator, open_request)

    assert filled.pk == open_request.pk
    open_request = stored(open_request)
    assert open_request.status == RequestStatus.FILLED
    assert open_request.pump == bunk
    assert open_request.filled_by == operator
    assert before <= open_request.filled_at <= timezone.now()
    assert open_request.litres_filled == Decimal("20")
    assert open_request.stock_entry is None  # a bunk keeps no stock
    assert open_request.emergency_litres == 0
    assert open_request.emergency_status == EmergencyStatus.NONE
    assert (filled.status, filled.litres_filled) == (RequestStatus.FILLED, Decimal("20"))


def test_the_driver_is_told_about_the_fill(operator, bunk, open_request, driver):
    fill(operator, open_request)

    alert = Notification.objects.get()
    assert alert.recipient == driver
    assert alert.title == f"Fuel filled: 20.00 L at {bunk.name}"
    assert alert.body == "Enter the duty particulars within 2 days."
    assert alert.link == "/driver/fuel"


def test_a_police_pump_fill_takes_the_litres_off_the_tank_and_links_the_stock_entry(vehicle, driver):
    pump = police_pump(UnitFactory(), petrol=Decimal("500"), diesel=Decimal("300"))
    operator = PumpStaffFactory(pump=pump, unit=pump.unit)
    request = ask(vehicle, driver, pump, "15")

    filled = fill(operator, request)

    assert stock_of(pump) == Decimal("285")
    assert stock_of(pump, FuelType.PETROL) == Decimal("500")
    entry = stored(filled).stock_entry
    assert entry.kind == StockEntryKind.DISPENSE
    assert entry.litres == Decimal("15")
    assert (entry.stock_before, entry.stock_after) == (Decimal("300"), Decimal("285"))
    assert entry.note == f"Fuel request #{request.pk}"
    assert entry.recorded_by == operator
    assert entry.tank.pump == pump


def test_a_fill_only_changes_that_request(operator, bunk, open_request, vehicle):
    other = ask(VehicleFactory(unit=vehicle.unit), DriverFactory(unit=vehicle.unit), bunk, "10")

    fill(operator, open_request)

    assert stored(other).status == RequestStatus.ISSUED


# --- emergency fills ---------------------------------------------------------------------------


def test_a_fill_beyond_the_quota_is_an_emergency_the_mto_is_alerted_to(operator, bunk, vehicle, driver, mto):
    use_up_the_month(vehicle, "90")  # 10 L of the normal quota left
    request = ask(vehicle, driver, bunk, "18", is_emergency=True, emergency_reason="Flood duty at Kavali")

    fill(operator, request)

    request = stored(request)
    assert request.status == RequestStatus.FILLED
    assert request.emergency_litres == Decimal("8")
    assert request.emergency_status == EmergencyStatus.PENDING
    alert = Notification.objects.get(recipient=mto)
    assert alert.title == "Emergency fill: AP39PA1234"
    assert alert.body == "8.00 L over the limit. Reason: Flood duty at Kavali"
    assert alert.link == "/mto/emergencies"
    assert Notification.objects.get(recipient=driver).title.startswith("Fuel filled: 18.00 L at ")


def test_the_emergency_alert_goes_to_the_vehicles_unit_not_the_pumps(operator, bunk, vehicle, driver, mto):
    use_up_the_month(vehicle, "90")
    request = ask(vehicle, driver, bunk, "15", is_emergency=True, emergency_reason="Chase")
    pumps_mto = MTOFactory(unit=operator.unit)

    fill(operator, request)

    assert not Notification.objects.filter(recipient=pumps_mto).exists()
    assert Notification.objects.filter(recipient=mto).count() == 1


def test_a_fill_within_the_quota_does_not_alert_the_mto(operator, open_request, mto):
    fill(operator, open_request)

    assert not Notification.objects.filter(recipient=mto).exists()


def test_every_litre_is_an_emergency_litre_once_the_quota_is_used_up(operator, bunk, vehicle, driver):
    use_up_the_month(vehicle, "103")  # over the limit through an earlier emergency: nothing normal is left
    request = ask(vehicle, driver, bunk, "6", is_emergency=True, emergency_reason="x")

    fill(operator, request)

    assert stored(request).emergency_litres == Decimal("6")


def test_last_months_fills_do_not_count_against_this_months_quota(operator, vehicle, open_request):
    filled_request(vehicle, Decimal("100"), timezone.now() - timedelta(days=45))

    fill(operator, open_request)

    assert stored(open_request).emergency_litres == 0


# --- refusals, in order ------------------------------------------------------------------------


def test_an_inactive_pump_cannot_fill(operator, bunk, open_request):
    bunk.is_active = False
    bunk.save()

    assert refusal(operator, open_request) == "Your pump is not active. Contact your MTO."
    assert stored(open_request).status == RequestStatus.ISSUED


@pytest.mark.parametrize("step", [redeem.check_pin, redeem.fill])
def test_a_request_for_another_pump_is_not_found(open_request, step):
    other = tieup_pump(UnitFactory())

    with pytest.raises(NotFound):
        step(operator=PumpStaffFactory(pump=other, unit=other.unit), request_id=open_request.pk, pin=PIN)

    assert stored(open_request).failed_pin_attempts == 0


def test_a_request_that_does_not_exist_is_not_found(operator):
    with pytest.raises(NotFound):
        redeem.fill(operator=operator, request_id=987654, pin=PIN)


@pytest.mark.parametrize("closed", [RequestStatus.FILLED, RequestStatus.CANCELLED, RequestStatus.EXPIRED])
def test_a_request_that_is_no_longer_open_cannot_be_filled(operator, bunk, vehicle, driver, closed):
    request = ask(vehicle, driver, bunk, "20", status=closed)

    assert refusal(operator, request) == NOT_OPEN


def test_the_same_pin_cannot_be_used_twice(operator, open_request, vehicle):
    fill(operator, open_request)

    assert refusal(operator, open_request) == NOT_OPEN
    assert vehicle.fuel_requests.filter(status=RequestStatus.FILLED).count() == 1
    assert Notification.objects.count() == 1  # the second try told nobody anything


def test_an_expired_pin_is_marked_expired_and_refused(operator, open_request):
    open_request.expires_at = timezone.now() - timedelta(minutes=1)
    open_request.save()

    assert refusal(operator, open_request) == EXPIRED

    assert stored(open_request).status == RequestStatus.EXPIRED  # kept although the call reported an error
    assert refusal(operator, open_request) == NOT_OPEN


def test_an_expired_pin_is_refused_even_with_the_wrong_digits(operator, open_request):
    open_request.expires_at = timezone.now() - timedelta(minutes=1)
    open_request.save()

    assert refusal(operator, open_request, pin="000000") == EXPIRED
    assert stored(open_request).failed_pin_attempts == 0


def test_a_paused_vehicle_is_refused(operator, open_request, vehicle):
    vehicle.status = VehicleStatus.PAUSED
    vehicle.save()

    assert refusal(operator, open_request) == NOT_ACTIVE
    assert stored(open_request).status == RequestStatus.ISSUED


def test_a_driver_who_is_no_longer_active_is_refused(operator, open_request, driver):
    driver.status = UserStatus.PAUSED
    driver.save()

    assert refusal(operator, open_request) == "The driver who raised this request is no longer active."
    assert stored(open_request).status == RequestStatus.ISSUED


def test_a_driver_who_is_no_longer_linked_to_the_vehicle_is_refused(operator, open_request, mto, driver):
    services.end_assignment(driver.vehicle_assignments.get(ended_at__isnull=True), mto)

    assert refusal(operator, open_request) == "The driver who raised this request is no longer linked to this vehicle."
    after = stored(open_request)
    assert after.status == RequestStatus.ISSUED
    assert after.failed_pin_attempts == 0


def test_a_vehicle_or_driver_problem_is_reported_before_the_pin_is_checked(operator, open_request, vehicle):
    vehicle.status = VehicleStatus.PAUSED
    vehicle.save()

    assert refusal(operator, open_request, pin="000000") == NOT_ACTIVE
    assert stored(open_request).failed_pin_attempts == 0


def test_a_wrong_pin_is_refused_and_counted(operator, open_request):
    assert refusal(operator, open_request, pin="000000") == "Wrong PIN. 4 attempt(s) left."

    open_request = stored(open_request)
    assert open_request.failed_pin_attempts == 1  # kept although the call reported an error
    assert open_request.status == RequestStatus.ISSUED
    assert refusal(operator, open_request, pin="111111") == "Wrong PIN. 3 attempt(s) left."
    assert stored(open_request).failed_pin_attempts == 2


def test_the_fifth_wrong_pin_cancels_the_request(operator, open_request):
    for left in (4, 3, 2, 1):
        assert refusal(operator, open_request, pin="000000") == f"Wrong PIN. {left} attempt(s) left."

    message = refusal(operator, open_request, pin="000000")

    assert message == "Too many wrong PINs. This request is cancelled; the driver must raise a new one."
    open_request = stored(open_request)
    assert open_request.status == RequestStatus.CANCELLED
    assert open_request.cancel_reason == "Too many wrong PIN attempts."
    assert open_request.failed_pin_attempts == 5
    assert refusal(operator, open_request) == NOT_OPEN  # the right PIN no longer helps


def test_the_right_pin_still_works_after_some_wrong_ones(operator, open_request):
    refusal(operator, open_request, pin="000000")
    refusal(operator, open_request, pin="000001")

    fill(operator, open_request)

    assert stored(open_request).status == RequestStatus.FILLED


@pytest.mark.parametrize("pin", ["", "12345", "1234567", "abcdef", "١٢٣٤٥٦", "12345é"])
def test_a_pin_that_is_not_six_matching_digits_is_just_wrong(operator, open_request, pin):
    assert refusal(operator, open_request, pin=pin) == "Wrong PIN. 4 attempt(s) left."


def test_a_bunk_that_stopped_selling_the_fuel_since_the_request_refuses_it(operator, bunk, open_request):
    bunk.sells_diesel = False
    bunk.save()

    assert refusal(operator, open_request) == "This pump does not sell diesel."
    assert stored(open_request).status == RequestStatus.ISSUED


def test_a_police_pump_that_stopped_selling_a_fuel_refuses_it_though_its_tank_remains(vehicle, driver):
    pump = police_pump(UnitFactory(), diesel=Decimal("300"))
    request = ask(vehicle, driver, pump, "20")
    pump.sells_diesel = False
    pump.save()

    assert refusal(PumpStaffFactory(pump=pump, unit=pump.unit), request) == "This pump does not sell diesel."
    assert stock_of(pump) == Decimal("300")


def test_a_police_pump_without_a_tank_for_the_fuel_refuses_it(vehicle, driver):
    pump = police_pump(UnitFactory(), diesel=Decimal("300"))
    request = ask(vehicle, driver, pump, "20")
    pump.tanks.filter(fuel_type=FuelType.DIESEL).delete()

    assert refusal(PumpStaffFactory(pump=pump, unit=pump.unit), request) == "This pump does not sell diesel."


def test_a_request_the_month_can_no_longer_cover_is_refused(operator, bunk, vehicle, driver):
    """Other fills since the request was raised used up what it counted on."""
    request = ask(vehicle, driver, bunk, "30")
    use_up_the_month(vehicle, "90")  # 10 L left + 10 L emergency

    assert refusal(operator, request) == (
        "This vehicle can now draw only 20.00 L. The driver must cancel this request and ask again."
    )
    assert stored(request).status == RequestStatus.ISSUED


def test_emergency_litres_already_drawn_this_month_come_off_what_can_be_drawn(operator, bunk, vehicle, driver):
    filled_request(vehicle, Decimal("95"), timezone.now(), emergency_litres=Decimal("0"))
    filled_request(vehicle, Decimal("10"), timezone.now(), emergency_litres=Decimal("5"))  # 105 used: 5 over
    request = ask(vehicle, driver, bunk, "10")

    assert refusal(operator, request) == (
        "This vehicle can now draw only 5.00 L. The driver must cancel this request and ask again."
    )


# --- a failed fill leaves nothing behind -------------------------------------------------------


def test_insufficient_police_stock_is_refused_and_changes_nothing(vehicle, driver):
    pump = police_pump(UnitFactory(), diesel=Decimal("12"))
    operator = PumpStaffFactory(pump=pump, unit=pump.unit)
    request = ask(vehicle, driver, pump, "20")

    assert refusal(operator, request) == (
        "Only 12.00 L of diesel in stock."
    )
    request = stored(request)
    assert request.status == RequestStatus.ISSUED
    assert request.stock_entry is None
    assert request.failed_pin_attempts == 0
    assert stock_of(pump) == Decimal("12")
    assert pump.tanks.get(fuel_type=FuelType.DIESEL).entries.count() == 0
    assert Notification.objects.count() == 0


def test_a_fill_that_drops_a_police_tank_below_the_alert_level_alerts_once(vehicle, driver):
    pump = police_pump(UnitFactory(), diesel=Decimal("110"))
    mto = MTOFactory(unit=pump.unit)
    request = ask(vehicle, driver, pump, "20")

    fill(PumpStaffFactory(pump=pump, unit=pump.unit), request)

    titles = set(Notification.objects.filter(recipient=mto).values_list("title", flat=True))
    assert titles == {f"Low diesel stock at {pump.name}"}


def test_a_petrol_vehicle_at_a_diesel_only_bunk_is_refused(vehicle, driver):
    vehicle.fuel_type = FuelType.PETROL
    vehicle.save()
    diesel_bunk = PumpFactory(unit=UnitFactory(), kind=PumpKind.TIE_UP, sells_petrol=False)
    request = FuelRequestFactory(vehicle=vehicle, driver=driver, pump=diesel_bunk, pin=PIN)

    message = refusal(PumpStaffFactory(pump=diesel_bunk, unit=diesel_bunk.unit), request)

    assert message == "This pump does not sell petrol."
