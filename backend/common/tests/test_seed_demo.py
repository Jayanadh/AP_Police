from io import StringIO

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone
from rest_framework.test import APIClient

from datetime import timedelta

from accounts.models import Role, Unit, User, UserStatus
from common.management.commands.seed_demo import DEMO_PASSWORD
from common.months import current_month
from common.periods import month_period
from fleet.models import Vehicle, VehicleAssignment, VehicleStatus
from fuel.models import FuelRequest, RequestStatus
from notifications.models import Notification
from pumps.models import Pump, PumpKind, PumpTank, StockEntry

pytestmark = pytest.mark.django_db

DEMO_LOGINS = [
    "pto",
    "mto.nellore",
    "mto.guntur",
    "ap3001",
    "ap3002",
    "ap3101",
    "ap4001",
    "ap4002",
    "ap4101",
    "pump.nlr.police",
    "pump.nlr.tieup",
    "pump.gnt.police",
    "pump.gnt.tieup",
]


@pytest.fixture(autouse=True)
def development(settings):
    settings.DEBUG = True


def seed(**options) -> str:
    out = StringIO()
    call_command("seed_demo", stdout=out, **options)
    return out.getvalue()


def log_in(username, password=DEMO_PASSWORD):
    cache.clear()  # the login throttle is per IP; a demo tour logs in as many people
    client = APIClient()
    response = client.post("/api/auth/login/", {"username": username, "password": password})
    return client, response


def current_links():
    return VehicleAssignment.objects.filter(ended_at__isnull=True).select_related("vehicle", "person")


def test_the_demo_password_is_the_documented_one():
    assert DEMO_PASSWORD == "Demo-pass-2026"


def test_running_twice_creates_no_duplicates():
    seed()
    seed()

    assert Unit.objects.count() == 2
    assert Pump.objects.count() == 4
    assert User.objects.count() == len(DEMO_LOGINS)
    assert Vehicle.objects.count() == 3
    assert VehicleAssignment.objects.filter(ended_at__isnull=True).count() == 6
    assert PumpTank.objects.count() == 4  # the two police pumps, petrol and diesel; bunks keep no stock
    assert StockEntry.objects.count() == 4  # the second run does not measure the tanks again


@pytest.mark.parametrize("username", DEMO_LOGINS)
def test_every_demo_login_works_with_the_shared_password(username):
    seed()

    client, response = log_in(username)

    assert response.status_code == 200
    assert response.json()["user"]["must_change_password"] is False
    assert client.get("/api/dashboard/").status_code == 200


def test_running_again_puts_every_password_back():
    seed()
    for user in User.objects.all():
        user.set_password("Changed-pass-1")
        user.must_change_password = True
        user.save()

    seed()

    _, response = log_in("mto.nellore")
    assert response.status_code == 200
    assert response.json()["user"]["must_change_password"] is False


def test_it_prints_a_table_of_logins_with_the_shared_password():
    output = seed()

    assert DEMO_PASSWORD in output
    lines = {line.split()[0]: line for line in output.splitlines() if line.split()}
    for username in DEMO_LOGINS:
        assert username in lines
    assert Role.PTO.value in lines["pto"]
    assert Role.MTO.value in lines["mto.guntur"]
    assert Role.PUMP_OPERATOR.value in lines["pump.nlr.tieup"]


def test_the_pto_is_a_staff_superuser():
    seed()

    pto = User.objects.get(username="pto")
    assert (pto.role, pto.is_superuser, pto.is_staff) == (Role.PTO, True, True)


def test_each_unit_has_its_chair_people_and_vehicles():
    seed()

    nellore = Unit.objects.get(code="NLR")
    guntur = Unit.objects.get(code="GNT")
    assert (nellore.name, nellore.district.name) == ("SPSR Nellore MTO", "Sri Potti Sriramulu Nellore")
    assert (guntur.name, guntur.district.name) == ("Guntur MTO", "Guntur")
    assert User.objects.get(username="mto.nellore").unit == nellore
    assert User.objects.get(username="mto.guntur").unit == guntur
    assert User.objects.get(username="ap3001").designation.name == "Inspector of Police"
    assert {u.username for u in User.objects.filter(unit=nellore, role=Role.OFFICER)} == {"ap3001", "ap3002"}
    assert {u.username for u in User.objects.filter(unit=nellore, role=Role.DRIVER)} == {"ap4001", "ap4002"}
    assert User.objects.filter(unit=guntur, role__in=(Role.OFFICER, Role.DRIVER)).count() == 2
    assert all(user.status == UserStatus.ACTIVE for user in User.objects.all())

    bolero = Vehicle.objects.get(registration_number="AP39PA1001")
    assert (bolero.model, bolero.fuel_type, bolero.tank_capacity_litres) == ("Bolero", "DIESEL", 60)
    assert (bolero.monthly_fuel_limit_litres, bolero.service_interval_km, bolero.service_interval_days) == (
        150,
        5000,
        180,
    )
    links = {(link.vehicle.registration_number, link.person.username) for link in current_links()}
    assert links == {
        ("AP39PA1001", "ap3001"),
        ("AP39PA1001", "ap4001"),
        ("AP39PA1002", "ap3002"),
        ("AP39PA1002", "ap4002"),
        ("AP07PB2001", "ap3101"),
        ("AP07PB2001", "ap4101"),
    }
    innova = Vehicle.objects.get(registration_number="AP39PA1002")
    swift = Vehicle.objects.get(registration_number="AP07PB2001")
    assert (innova.model, innova.fuel_type, innova.tank_capacity_litres, innova.monthly_fuel_limit_litres) == (
        "Innova",
        "DIESEL",
        55,
        120,
    )
    assert (swift.model, swift.fuel_type, swift.tank_capacity_litres, swift.monthly_fuel_limit_litres) == (
        "Swift",
        "PETROL",
        37,
        80,
    )


def test_the_four_pumps_have_their_stock_and_their_staff():
    seed()

    def stock(pump_name):
        return {tank.fuel_type: tank.current_stock_litres for tank in PumpTank.objects.filter(pump__name=pump_name)}

    assert stock("Nellore DPO Police Pump") == {"PETROL": 500, "DIESEL": 400}
    assert stock("Guntur Police Pump") == {"PETROL": 300, "DIESEL": 90}
    assert stock("Sri Venkateswara Fuels") == {} and stock("Krishna Fuel Point") == {}

    krishna = Pump.objects.get(name="Krishna Fuel Point")
    assert (krishna.kind, krishna.sells_petrol, krishna.sells_diesel) == ("TIE_UP", True, False)
    assert Pump.objects.get(name="Sri Venkateswara Fuels").sells_diesel is True
    assert str(Pump.objects.get(name="Nellore DPO Police Pump").latitude) == "14.442600"
    assert str(Pump.objects.get(name="Guntur Police Pump").longitude) == "80.436500"

    staff = {user.username: user.pump.name for user in User.objects.filter(role=Role.PUMP_OPERATOR)}
    assert staff == {
        "pump.nlr.police": "Nellore DPO Police Pump",
        "pump.nlr.tieup": "Sri Venkateswara Fuels",
        "pump.gnt.police": "Guntur Police Pump",
        "pump.gnt.tieup": "Krishna Fuel Point",
    }


def test_running_again_links_people_whose_links_ended_and_reports_a_vehicle_it_cannot_link():
    seed()
    for link in current_links().filter(vehicle__registration_number__in=["AP39PA1001", "AP07PB2001"]):
        link.ended_at = timezone.now()
        link.ended_by = link.assigned_by
        link.save()
    Vehicle.objects.filter(registration_number="AP07PB2001").update(status=VehicleStatus.TERMINATED)

    output = seed()

    assert {(link.vehicle.registration_number, link.person.username) for link in current_links()} >= {
        ("AP39PA1001", "ap3001"),
        ("AP39PA1001", "ap4001"),
    }
    assert not current_links().filter(vehicle__registration_number="AP07PB2001").exists()
    assert "Not linked ap3101 to AP07PB2001: Only active or paused vehicles can be linked." in output
    assert User.objects.count() == len(DEMO_LOGINS)  # the rest of the demo is still there


def test_guntur_starts_with_one_low_stock_alert_even_after_a_second_run():
    seed()
    seed()

    alerts = Notification.objects.filter(title__startswith="Low diesel stock")
    assert {alert.recipient.username for alert in alerts} == {"mto.guntur", "pump.gnt.police"}
    assert alerts.count() == 2
    assert not Notification.objects.filter(title__startswith="Low petrol stock").exists()


def test_it_refuses_to_run_outside_development_without_force(settings):
    settings.DEBUG = False

    with pytest.raises(CommandError, match=r"^seed_demo is for development\. Use --force to run it anyway\.$"):
        seed()

    assert not User.objects.exists()


def test_force_runs_it_anyway(settings):
    settings.DEBUG = False

    seed(force=True)

    assert User.objects.filter(username="pto").exists()


def test_demo_people_can_complete_a_fill_and_a_rerun_leaves_the_stock_alone():
    seed()
    police_pump = Pump.objects.get(name="Nellore DPO Police Pump")
    driver, _ = log_in("ap4001")
    raised = driver.post("/api/fuel/requests/", {"litres": "20", "pump": police_pump.id})
    assert raised.status_code == 201
    operator, _ = log_in("pump.nlr.police")
    [waiting] = operator.get("/api/fuel/incoming/").json()

    filled = operator.post(f"/api/fuel/incoming/{waiting['id']}/fill/", {"pin": raised.json()["pin"]})

    assert filled.status_code == 200
    diesel = PumpTank.objects.get(pump__name="Nellore DPO Police Pump", fuel_type="DIESEL")
    assert diesel.current_stock_litres == 380

    seed()

    diesel.refresh_from_db()
    assert diesel.current_stock_litres == 380


def test_the_demo_has_last_months_fills_at_the_bunks():
    """So the statements have something to show: last month's fills, all with their duty particulars."""
    seed()
    last_month = month_period(current_month() - timedelta(days=1))
    start, end = last_month.bounds()

    fills = list(FuelRequest.objects.select_related("pump", "vehicle", "driver"))
    assert len(fills) == 4
    for fill in fills:
        assert fill.status == RequestStatus.FILLED
        assert start <= fill.filled_at < end
        assert fill.pump.kind == PumpKind.TIE_UP
        assert fill.duty_particulars and fill.duty_submitted_at is not None
        assert fill.driver.vehicle_assignments.filter(vehicle=fill.vehicle, ended_at__isnull=True).exists()

    seed()  # a second run adds no more history

    assert FuelRequest.objects.count() == 4
