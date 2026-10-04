"""The whole spec, driven through the HTTP API the way the app drives it.

Every person is a separate `APIClient` that logs in through `/api/auth/login/`. The only thing set up outside the API
is the PTO, who exists before anyone can use the system. One test per flow; flows 2 to 8 start from the office that
flow 1 builds (`build_office`).
"""
import re
from datetime import timedelta
from io import StringIO
from types import SimpleNamespace

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from rest_framework.test import APIClient

from common.months import current_month, format_month, today_ist
from common.periods import month_period
from fuel.models import FuelRequest
from testing.factories import PASSWORD as PTO_PASSWORD
from testing.factories import PTOFactory

pytestmark = pytest.mark.django_db

FIRST_PASSWORD = "First-pass-2026"  # what the PTO / MTO type in when they create a login
OWN_PASSWORD = "Fresh-pass-2026"  # what each person chooses at their first login
PASSWORDS: dict[str, str] = {}  # login ID -> the password its owner chose, once they have logged in
NELLORE = "Sri Potti Sriramulu Nellore"
GUNTUR = "Guntur"


@pytest.fixture(autouse=True)
def _passwords_start_over():
    PASSWORDS.clear()


# --- people and calls ---------------------------------------------------------------------------------------------
def login(username, password=None):
    """A new client logged in as `username`. Someone logging in with a password another person set chooses their own
    first, as the app makes them do (the API answers nothing else until then)."""
    cache.clear()  # the login throttles and a flow logs in as a dozen people within a minute
    client = APIClient()
    password = password or PASSWORDS.get(username, FIRST_PASSWORD)
    response = client.post("/api/auth/login/", {"username": username, "password": password})
    assert response.status_code == 200, response.content
    if response.json()["user"]["must_change_password"]:
        ok(client.post("/api/auth/change-password/", {"old_password": password, "new_password": OWN_PASSWORD}), 204)
        PASSWORDS[username] = OWN_PASSWORD
    return client


def ok(response, status=200):
    assert response.status_code == status, f"expected {status}, got {response.status_code}: {response.content!r}"
    return response.json() if response.content else None


def refused(response, message_part):
    assert response.status_code == 400, f"expected 400, got {response.status_code}: {response.content!r}"
    assert message_part in response.json()["detail"]


def alerts(client):
    return ok(client.get("/api/notifications/"))


def alert_titles(client):
    return [alert["title"] for alert in alerts(client)]


def master_ids(client):
    return {
        kind: {row["name"]: row["id"] for row in ok(client.get(f"/api/masters/{kind}/"))}
        for kind in ("districts", "designations", "cadres")
    }


# --- the setup steps (flow 1) ---------------------------------------------------------------------------------------
def open_office(pto, name, code, district, chair, emp_id):
    """The PTO creates an office with its MTO; the MTO logs in for the first time and chooses a password."""
    masters = master_ids(pto)
    unit = ok(
        pto.post(
            "/api/units/",
            {
                "name": name,
                "code": code,
                "district": masters["districts"][district],
                "mto_account": {
                    "username": chair,
                    "full_name": f"{name} chair",
                    "emp_id": emp_id,
                    "designation": masters["designations"]["Reserve Inspector"],
                    "cadre": masters["cadres"]["Armed Reserve"],
                    "mobile": "9876500001",
                    "password": FIRST_PASSWORD,
                },
            },
        ),
        201,
    )
    cache.clear()
    mto = APIClient()
    ok(mto.post("/api/auth/login/", {"username": chair, "password": FIRST_PASSWORD}))
    assert ok(mto.get("/api/auth/session/"))["user"]["must_change_password"] is True
    blocked = mto.get("/api/vehicles/")  # nothing else until the MTO has their own password
    assert (blocked.status_code, blocked.json()) == (403, {"detail": "Change your password before you continue."})
    ok(mto.post("/api/auth/change-password/", {"old_password": FIRST_PASSWORD, "new_password": OWN_PASSWORD}), 204)
    PASSWORDS[chair] = OWN_PASSWORD
    assert ok(mto.get("/api/auth/session/"))["user"]["must_change_password"] is False
    return SimpleNamespace(unit=unit, mto=mto, masters=master_ids(mto))


def add_vehicle(mto):
    """A diesel Bolero with a 60 L tank, serviced every 5,000 km or 180 days, that had 12,000 km on it when added."""
    return ok(
        mto.post(
            "/api/vehicles/",
            {
                "registration_number": "AP39PA1001",
                "vehicle_type": "JEEP",
                "make": "Mahindra",
                "model": "Bolero",
                "year_of_manufacture": 2022,
                "fuel_type": "DIESEL",
                "tank_capacity_litres": "60",
                "odometer_at_onboarding_km": 12000,
                "service_interval_km": 5000,
                "service_interval_days": 180,
            },
        ),
        201,
    )


def add_person(office, kind, emp_id, name, designation, cadre="Civil"):
    """A driver (`kind="drivers"`) or an officer (`kind="officers"`) of the office."""
    masters = office.masters
    district = office.unit["district_name"]
    body = {
        "full_name": name,
        "emp_id": emp_id,
        "designation": masters["designations"][designation],
        "district": masters["districts"][district],
        "cadre": masters["cadres"][cadre],
        "mobile": "9876500002",
        "password": FIRST_PASSWORD,
    }
    if kind == "drivers":
        body.update(licence_number="AP0320240001001", licence_valid_till="2031-03-31")
    return ok(office.mto.post(f"/api/{kind}/", body), 201)


def link(mto, vehicle, person):
    return ok(mto.post(f"/api/vehicles/{vehicle['id']}/assignments/", {"person": person["id"]}), 201)


def add_pump(office, name, kind, latitude, longitude):
    return ok(
        office.mto.post(
            "/api/pumps/",
            {
                "name": name,
                "kind": kind,
                "address": f"{name}, {office.unit['district_name']}",
                "district": office.masters["districts"][office.unit["district_name"]],
                "latitude": latitude,
                "longitude": longitude,
            },
        ),
        201,
    )


def add_staff(mto, pump, username, name):
    return ok(
        mto.post(
            "/api/pump-staff/",
            {"username": username, "full_name": name, "pump": pump["id"], "password": FIRST_PASSWORD},
        ),
        201,
    )


def approve_officer(pto, officer):
    waiting = ok(pto.get("/api/approvals/?status=PENDING"))
    request = next(row for row in waiting if row["officer"] and row["officer"]["id"] == officer["id"])
    return ok(pto.post(f"/api/approvals/{request['id']}/approve/", {"note": "Verified."}))


def set_limit(mto, vehicle, litres):
    return ok(mto.patch(f"/api/vehicles/{vehicle['id']}/", {"monthly_fuel_limit_litres": litres}))


def build_office(pto):
    """Flow 1 without the checks in between: an office with a vehicle, its driver and officer, a police pump and a
    tie-up bunk with their staff, and a monthly limit of 150 L. Returns the office with a client for every person."""
    office = open_office(pto, "SPSR Nellore MTO", "NLR", NELLORE, "mto.nellore", "AP2001")
    office.vehicle = add_vehicle(office.mto)
    driver = add_person(office, "drivers", "AP4001", "Ravi Kumar", "Police Constable")
    officer = add_person(office, "officers", "AP3001", "S. Venkata Rao", "Inspector of Police")
    approve_officer(pto, officer)
    link(office.mto, office.vehicle, officer)
    link(office.mto, office.vehicle, driver)
    office.police_pump = add_pump(office, "Nellore DPO Police Pump", "POLICE", "14.442600", "79.986500")
    office.bunk_pump = add_pump(office, "Sri Venkateswara Fuels", "TIE_UP", "14.450000", "79.990000")
    add_staff(office.mto, office.police_pump, "pump.nlr.police", "Police pump staff")
    add_staff(office.mto, office.bunk_pump, "pump.nlr.tieup", "Bunk staff")
    set_limit(office.mto, office.vehicle, "150")

    office.driver_id, office.officer_id = driver["id"], officer["id"]
    office.driver, office.officer = login("ap4001"), login("ap3001")
    office.police, office.bunk = login("pump.nlr.police"), login("pump.nlr.tieup")
    return office


# --- fuel steps shared by the flows ---------------------------------------------------------------------------------
def tank_id(operator, fuel_type):
    return next(tank["id"] for tank in ok(operator.get("/api/tanks/")) if tank["fuel_type"] == fuel_type)


def set_opening(mto, fuel_type, litres):
    """The MTO sets the opening stock of the office's police pump's tank, once."""
    return ok(mto.post(f"/api/tanks/{tank_id(mto, fuel_type)}/opening/", {"litres": litres}))


def stock(client, fuel_type):
    return next(tank for tank in ok(client.get("/api/tanks/")) if tank["fuel_type"] == fuel_type)[
        "current_stock_litres"
    ]


def raise_request(driver, litres, pump, **extra):
    """The driver asks for `litres`, to be filled at `pump`."""
    return ok(driver.post("/api/fuel/requests/", {"litres": litres, "pump": pump["id"], **extra}), 201)


def redeem(operator, request):
    """The staff find the request in their incoming list, check the driver's PIN to see the litres, and fill them."""
    assert request["id"] in [row["id"] for row in ok(operator.get("/api/fuel/incoming/"))]
    checked = ok(operator.post(f"/api/fuel/incoming/{request['id']}/check-pin/", {"pin": request["pin"]}))
    assert checked["litres_requested"] == request["litres_requested"]
    return ok(operator.post(f"/api/fuel/incoming/{request['id']}/fill/", {"pin": request["pin"]}))


def fill(office, pump, operator, litres, **extra):
    """The driver asks for `litres` at `pump` and its staff (`operator`) fill them."""
    return redeem(operator, raise_request(office.driver, litres, pump, **extra))


def quota(client, vehicle):
    return ok(client.get(f"/api/fuel/vehicles/{vehicle['id']}/quota/"))


# --- fixtures --------------------------------------------------------------------------------------------------------
@pytest.fixture
def pto():
    PTOFactory(username="pto")
    return login("pto", PTO_PASSWORD)


@pytest.fixture
def office(pto):
    return build_office(pto)


# --- 1. setup ----------------------------------------------------------------------------------------------------
def test_setup_pto_opens_an_office_and_the_mto_builds_its_fleet_and_pumps(pto):
    office = open_office(pto, "SPSR Nellore MTO", "NLR", NELLORE, "mto.nellore", "AP2001")
    mto = office.mto
    assert office.unit["mto"]["username"] == "mto.nellore"

    # The password the PTO typed no longer works; the one the MTO chose does.
    old = APIClient().post("/api/auth/login/", {"username": "mto.nellore", "password": FIRST_PASSWORD})
    refused(old, "Invalid username or password.")
    login("mto.nellore", OWN_PASSWORD)

    vehicle = add_vehicle(mto)
    assert (vehicle["status"], vehicle["monthly_fuel_limit_litres"]) == ("ACTIVE", "0.00")
    driver = add_person(office, "drivers", "AP4001", "Ravi Kumar", "Police Constable")
    assert driver["status"] == "ACTIVE"

    # A new officer waits for the PTO: no login, no vehicle link.
    officer = add_person(office, "officers", "AP3001", "S. Venkata Rao", "Inspector of Police")
    assert officer["status"] == "PENDING_APPROVAL"
    refused(
        APIClient().post("/api/auth/login/", {"username": "ap3001", "password": FIRST_PASSWORD}),
        "waiting for PTO approval",
    )
    refused(mto.post(f"/api/vehicles/{vehicle['id']}/assignments/", {"person": officer["id"]}), "active")
    waiting = ok(pto.get("/api/approvals/?status=PENDING"))
    assert [row["kind"] for row in waiting] == ["OFFICER_CREATE"]
    assert "New officer waiting for approval" in alert_titles(pto)

    approved = approve_officer(pto, officer)
    assert approved["status"] == "APPROVED"
    assert "Officer approved" in alert_titles(mto)
    officer_client = login("ap3001")

    # The MTO links the officer and the driver; the vehicle shows both.
    link(mto, vehicle, officer)
    link(mto, vehicle, driver)
    linked = ok(mto.get(f"/api/vehicles/{vehicle['id']}/"))
    assert linked["current_officer"]["emp_id"] == "AP3001"
    assert linked["current_driver"]["emp_id"] == "AP4001"
    assert [row["registration_number"] for row in ok(officer_client.get("/api/me/vehicles/"))["vehicles"]] == [
        "AP39PA1001"
    ]

    # A police pump (with tanks), a tie-up bunk (without) and their staff.
    police = add_pump(office, "Nellore DPO Police Pump", "POLICE", "14.442600", "79.986500")
    assert sorted(tank["fuel_type"] for tank in police["tanks"]) == ["DIESEL", "PETROL"]
    bunk = add_pump(office, "Sri Venkateswara Fuels", "TIE_UP", "14.450000", "79.990000")
    assert bunk["tanks"] == []
    add_staff(mto, police, "pump.nlr.police", "Police pump staff")
    add_staff(mto, bunk, "pump.nlr.tieup", "Bunk staff")
    operator = ok(login("pump.nlr.police").get("/api/auth/session/"))["user"]
    assert (operator["role"], operator["pump_name"], operator["pump_kind"]) == (
        "PUMP_OPERATOR",
        "Nellore DPO Police Pump",
        "POLICE",
    )

    # Every pump shows up in the directory every logged-in person can read.
    directory = ok(officer_client.get("/api/pump-directory/"))
    assert {pump["name"]: pump["kind"] for pump in directory} == {
        "Nellore DPO Police Pump": "POLICE",
        "Sri Venkateswara Fuels": "TIE_UP",
    }

    # The monthly limit is set last: before it the vehicle has no fuel.
    assert quota(mto, vehicle)["limit_litres"] == "0.00"
    set_limit(mto, vehicle, "150")
    assert quota(mto, vehicle)["limit_litres"] == "150.00"
    assert quota(officer_client, vehicle)["remaining_litres"] == "150.00"

    summary = ok(pto.get("/api/dashboard/"))
    assert [(row["code"], row["vehicles_active"]) for row in summary["units"]] == [("NLR", 1)]
    assert summary["pending_approvals"] == 0


# --- 2. daily fuel -------------------------------------------------------------------------------------------------
def test_daily_fuel_opening_stock_request_pin_fill_and_duty_particulars(office):
    registration = office.vehicle["registration_number"]
    set_opening(office.mto, "DIESEL", "400")
    assert stock(office.police, "DIESEL") == "400.00"

    raised = raise_request(office.driver, "40", office.police_pump)
    assert re.fullmatch(r"\d{6}", raised["pin"])
    assert (raised["status"], raised["registration_number"]) == ("ISSUED", registration)

    filled = redeem(office.police, raised)
    assert (filled["status"], filled["litres_filled"], filled["pump_name"]) == (
        "FILLED",
        "40.00",
        "Nellore DPO Police Pump",
    )
    assert filled["pin"] is None  # the PIN is for the driver's eyes only

    # The same PIN cannot be used twice, and the stock dropped by the fill.
    refused(
        office.police.post(f"/api/fuel/incoming/{raised['id']}/fill/", {"pin": raised["pin"]}),
        "no longer open",
    )
    assert ok(office.police.get("/api/fuel/incoming/")) == []
    assert stock(office.police, "DIESEL") == "360.00"
    assert stock(office.mto, "DIESEL") == "360.00"
    ledger = ok(office.police.get(f"/api/tanks/{tank_id(office.police, 'DIESEL')}/entries/"))
    assert sorted(entry["kind"] for entry in ledger) == ["DISPENSE", "OPENING"]

    # The driver owes the particulars; once entered, the officer sees them with the fill.
    owed = ok(office.driver.get("/api/dashboard/"))["duty_due"]
    assert [row["id"] for row in owed] == [filled["id"]]
    text = "Escort duty for the SP's visit to Kavali, 120 km."
    duty = ok(office.driver.post(f"/api/fuel/requests/{filled['id']}/duty/", {"duty_particulars": text}))
    assert duty["duty_particulars"] == text
    assert ok(office.driver.get("/api/dashboard/"))["duty_due"] == []

    recent = ok(office.officer.get("/api/dashboard/"))["recent_fills"]
    assert [(fill["litres_filled"], fill["duty_particulars"]) for fill in recent] == [("40.00", text)]
    seen = ok(office.officer.get("/api/fuel/requests/?status=FILLED"))
    assert [(row["id"], row["duty_particulars"]) for row in seen] == [(filled["id"], text)]
    assert quota(office.officer, office.vehicle)["remaining_litres"] == "110.00"

    # The pump's and the MTO's dashboards add the fill up.
    pump = ok(office.police.get("/api/dashboard/"))
    assert pump["today_fills"] == {"count": 1, "litres": "40.00"}
    summary = ok(office.mto.get("/api/dashboard/"))
    assert summary["fuel"] == {"used_litres": "40.00", "limit_litres": "150.00"}
    assert [(row["registration_number"], row["used_litres"]) for row in summary["top_vehicles"]] == [
        (registration, "40.00")
    ]


# --- 3. emergency --------------------------------------------------------------------------------------------------
def test_emergency_fill_at_a_tie_up_bunk_is_allowed_and_extra_quota_restores_the_balance(office):
    mto, registration = office.mto, office.vehicle["registration_number"]
    set_limit(mto, office.vehicle, "60")
    set_opening(mto, "DIESEL", "400")

    fill(office, office.police_pump, office.police, "60")  # the whole month's limit
    assert quota(mto, office.vehicle)["remaining_litres"] == "0.00"

    # Beyond the limit a plain request is refused; an emergency needs its reason.
    bunk_id = office.bunk_pump["id"]
    refused(office.driver.post("/api/fuel/requests/", {"litres": "8", "pump": bunk_id}), "Mark it as an emergency")
    refused(
        office.driver.post(
            "/api/fuel/requests/", {"litres": "8", "pump": bunk_id, "is_emergency": True, "emergency_reason": " "}
        ),
        "Mark it as an emergency",
    )
    emergency = raise_request(
        office.driver, "8", office.bunk_pump, is_emergency=True,
        emergency_reason="Ambulance escort on NH16, no time to wait.",
    )
    assert emergency["is_emergency"] is True

    filled = redeem(office.bunk, emergency)
    assert (filled["pump_kind"], filled["emergency_litres"], filled["emergency_status"]) == (
        "TIE_UP",
        "8.00",
        "PENDING",
    )

    # The MTO is alerted, sees it among the pending emergencies and allows it.
    alert = next(a for a in alerts(mto) if a["title"] == f"Emergency fill: {registration}")
    assert alert["link"] == "/mto/emergencies"
    pending = ok(mto.get("/api/fuel/requests/?emergency=pending"))
    assert [row["id"] for row in pending] == [filled["id"]]
    allowed = ok(mto.post(f"/api/fuel/requests/{filled['id']}/allow-emergency/"))
    assert allowed["emergency_status"] == "ALLOWED"
    assert "Emergency fill allowed" in alert_titles(office.driver)
    assert ok(mto.get("/api/fuel/requests/?emergency=pending")) == []

    # The 8 L come off the month's additional quota, which has none: the balance is negative.
    overdrawn = quota(mto, office.vehicle)
    assert (overdrawn["additional_litres"], overdrawn["used_litres"]) == ("0.00", "68.00")
    assert (overdrawn["remaining_litres"], overdrawn["additional_balance_litres"]) == ("-8.00", "-8.00")
    assert (overdrawn["emergency_used_litres"], overdrawn["emergency_remaining_litres"]) == ("8.00", "2.00")

    # Additional quota needs its letter; with it the balance recovers.
    month = format_month(current_month())
    grant = {"vehicle": office.vehicle["id"], "month": month, "litres": "30", "approved_by": "DIG Nellore Range"}
    assert mto.post("/api/fuel/grants/", grant, format="multipart").status_code == 400
    letter = SimpleUploadedFile("sanction.pdf", b"%PDF-1.4 sanction of 30 litres", content_type="application/pdf")
    added = ok(mto.post("/api/fuel/grants/", {**grant, "letter": letter}, format="multipart"), 201)
    assert added["registration_number"] == registration
    assert b"".join(mto.get(added["letter_url"]).streaming_content).startswith(b"%PDF-1.4")
    assert "Additional fuel for AP39PA1001" in alert_titles(office.driver)

    restored = quota(mto, office.vehicle)
    assert (restored["limit_litres"], restored["remaining_litres"]) == ("90.00", "22.00")
    assert restored["additional_balance_litres"] == "22.00"
    assert quota(office.driver, office.vehicle) == restored


# --- 4. low stock --------------------------------------------------------------------------------------------------
def test_dropping_below_100_litres_alerts_the_mto_and_the_pump_staff_exactly_once(office):
    pump_name = office.police_pump["name"]
    low = f"Low diesel stock at {pump_name}"
    set_opening(office.mto, "PETROL", "500")
    set_opening(office.mto, "DIESEL", "150")
    assert low not in alert_titles(office.mto)

    fill(office, office.police_pump, office.police, "30")  # 120 L left
    assert low not in alert_titles(office.mto)
    fill(office, office.police_pump, office.police, "30")  # 90 L left: below 100
    fill(office, office.police_pump, office.police, "20")  # 70 L left: still low, no second alert

    assert stock(office.police, "DIESEL") == "70.00"
    assert alert_titles(office.mto).count(low) == 1
    assert alert_titles(office.police).count(low) == 1
    assert not [title for title in alert_titles(office.mto) if title.startswith("Low petrol")]
    tanks = {tank["fuel_type"]: tank["is_low"] for tank in ok(office.mto.get("/api/dashboard/"))["tanks"]}
    assert tanks == {"DIESEL": True, "PETROL": False}

    # More fills while low are no new drop; asking for more than the pump holds is refused at once.
    fill(office, office.police_pump, office.police, "50")  # 20 L left
    refused(
        office.driver.post("/api/fuel/requests/", {"litres": "30", "pump": office.police_pump["id"]}),
        "Nellore DPO Police Pump has only 20.00 L of diesel",
    )
    assert stock(office.police, "DIESEL") == "20.00"
    assert alert_titles(office.mto).count(low) == 1


# --- 5. bunk statements --------------------------------------------------------------------------------------------
def test_a_bunk_statement_is_the_record_of_every_fill_at_the_bunk(pto, office):
    fills = [fill(office, office.bunk_pump, office.bunk, litres) for litres in ("40", "25")]
    last_month = month_period(current_month() - timedelta(days=1))
    query = f"from={last_month.start.isoformat()}&to={last_month.end.isoformat()}"
    start, _ = last_month.bounds()
    FuelRequest.objects.filter(pk__in=[row["id"] for row in fills]).update(
        filled_at=start + timedelta(days=9, hours=10)  # a fill is dated by when it happened: move them to last month
    )
    assert quota(office.mto, office.vehicle)["used_litres"] == "0.00"  # those fills belong to last month now

    # The bunk, its office's MTO and the PTO all see the same record: nothing is submitted, nothing disputed.
    own = ok(office.bunk.get(f"/api/fuel/bunk-statement/?{query}"))
    assert (own["pump"]["name"], own["label"], own["fills"], own["diesel_litres"]) == (
        "Sri Venkateswara Fuels",
        last_month.label,
        2,
        "65.00",
    )
    assert [row["litres"] for row in own["rows"]] == ["40.00", "25.00"]
    chosen = f"pump={office.bunk_pump['id']}&{query}"
    assert ok(office.mto.get(f"/api/fuel/bunk-statement/?{chosen}")) == own
    assert ok(pto.get(f"/api/fuel/bunk-statement/?{chosen}")) == own

    # The MTO's fuel statement of last month shows the same fills at the bunk, and both download as Excel.
    report = ok(office.mto.get(f"/api/fuel/statement/?{query}"))
    assert [(row["pump_name"], row["litres"]) for row in report["by_pump"]] == [("Sri Venkateswara Fuels", "65.00")]
    for download in (
        office.mto.get(f"/api/fuel/bunk-statement/export/?{chosen}"),
        office.mto.get(f"/api/fuel/statement/export/?{query}"),
    ):
        assert download.status_code == 200
        assert download["Content-Type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# --- 6. officer transfer -------------------------------------------------------------------------------------------
def test_new_mto_asks_for_an_officer_and_the_old_mto_accepts(pto, office):
    new = open_office(pto, "Guntur MTO", "GNT", GUNTUR, "mto.guntur", "AP2002")

    found = ok(new.mto.get("/api/officers/lookup/?emp_id=ap3001"))
    assert (found["emp_id"], found["unit_name"]) == ("AP3001", "SPSR Nellore MTO")
    assert new.mto.get("/api/officers/lookup/?emp_id=AP9999").status_code == 404

    asked = ok(new.mto.post("/api/transfers/", {"officer": found["id"], "note": "Needed for Guntur range."}), 201)
    assert (asked["status"], asked["from_unit_name"], asked["to_unit_name"]) == (
        "PENDING",
        "SPSR Nellore MTO",
        "Guntur MTO",
    )
    assert "Transfer request for S. Venkata Rao" in alert_titles(office.mto)
    assert ok(office.mto.get("/api/dashboard/"))["transfers_to_decide"] == 1
    # Only the old office decides.
    refused(new.mto.post(f"/api/transfers/{asked['id']}/accept/"), "current MTO office")

    accepted = ok(office.mto.post(f"/api/transfers/{asked['id']}/accept/"))
    assert accepted["status"] == "ACCEPTED"
    assert "Transfer accepted" in alert_titles(new.mto)

    # The old vehicle link ended (the driver's did not), and the officer now belongs to the new office.
    vehicle = ok(office.mto.get(f"/api/vehicles/{office.vehicle['id']}/"))
    assert vehicle["current_officer"] is None
    assert vehicle["current_driver"]["emp_id"] == "AP4001"
    links = ok(office.mto.get(f"/api/vehicles/{office.vehicle['id']}/assignments/"))
    officer_link = next(row for row in links if row["kind"] == "OFFICER")
    assert officer_link["ended_at"] is not None

    session = ok(office.officer.get("/api/auth/session/"))["user"]
    assert (session["unit"], session["unit_name"]) == (new.unit["id"], "Guntur MTO")
    mine = ok(office.officer.get("/api/me/vehicles/"))
    assert mine["vehicles"] == [] and mine["mto"]["unit_name"] == "Guntur MTO"
    assert [row["emp_id"] for row in ok(new.mto.get("/api/officers/"))] == ["AP3001"]
    assert ok(office.mto.get("/api/officers/")) == []
    assert ok(office.officer.get("/api/dashboard/"))["vehicles"] == []
    assert office.mto.get(f"/api/officers/{office.officer_id}/").status_code == 404


# --- 7. vehicle termination ----------------------------------------------------------------------------------------
def test_vehicle_termination_needs_the_pto_and_ends_the_links(pto, office):
    vehicle_id = office.vehicle["id"]
    note = {"note": "Accident, beyond repair."}
    pending = ok(office.mto.post(f"/api/vehicles/{vehicle_id}/request-termination/", note))
    assert pending["status"] == "TERMINATION_PENDING"
    assert "Vehicle termination waiting for approval" in alert_titles(pto)
    assert ok(pto.get("/api/dashboard/"))["pending_approvals"] == 1

    # Nothing changes until the PTO decides: the links stay, and the vehicle takes no fuel.
    assert ok(office.mto.get(f"/api/vehicles/{vehicle_id}/"))["current_driver"] is not None
    refused(
        office.driver.post("/api/fuel/requests/", {"litres": "10", "pump": office.bunk_pump["id"]}),
        "paused or terminated",
    )

    request = next(row for row in ok(pto.get("/api/approvals/?status=PENDING")) if row["vehicle"])
    assert request["vehicle"]["registration_number"] == office.vehicle["registration_number"]
    ok(pto.post(f"/api/approvals/{request['id']}/approve/", {"note": "Approved for disposal."}))

    terminated = ok(office.mto.get(f"/api/vehicles/{vehicle_id}/"))
    assert terminated["status"] == "TERMINATED"
    assert (terminated["current_officer"], terminated["current_driver"]) == (None, None)
    assert "Vehicle termination approved" in alert_titles(office.mto)
    links = ok(office.mto.get(f"/api/vehicles/{vehicle_id}/assignments/"))
    assert len(links) == 2 and all(row["ended_at"] for row in links)
    assert ok(office.mto.get(f"/api/drivers/{office.driver_id}/"))["current_vehicles"] == []
    assert ok(office.driver.get("/api/me/vehicles/"))["vehicles"] == []
    refused(
        office.driver.post("/api/fuel/requests/", {"litres": "10", "pump": office.bunk_pump["id"]}),
        "not linked to a vehicle",
    )
    assert ok(office.mto.get("/api/dashboard/"))["vehicles"] == {"active": 0, "paused": 0, "termination_pending": 0}
    assert ok(office.driver.get("/api/dashboard/"))["vehicle"] is None
    assert ok(office.officer.get("/api/dashboard/"))["vehicles"] == []


# --- 8. odometer and service ---------------------------------------------------------------------------------------
def test_driver_odometer_reading_crossing_the_service_interval_alerts_the_mto_once(office):
    registration = office.vehicle["registration_number"]

    def run_jobs():
        out = StringIO()
        call_command("run_scheduled_jobs", stdout=out)
        return dict(line.split(": ") for line in out.getvalue().splitlines())

    # No reading yet: the MTO sees the vehicle as missing a reading, and nothing is due.
    assert [row["registration_number"] for row in ok(office.mto.get("/api/odometer/missing/"))] == [registration]
    assert ok(office.mto.get("/api/dashboard/"))["missing_odometer"] == 1
    assert run_jobs()["alert_service_due"] == "0"
    assert ok(office.mto.get("/api/service-due/")) == []

    # 12,000 km at onboarding + 5,000 km interval: a reading of 17,000 km makes it due.
    refused(office.driver.post("/api/odometer/", {"reading_km": 11000}), "can't be lower")
    reading = ok(office.driver.post("/api/odometer/", {"reading_km": 17000}), 201)
    assert (reading["reading_km"], reading["registration_number"]) == (17000, registration)
    assert ok(office.mto.get("/api/odometer/missing/")) == []
    assert ok(office.mto.get("/api/dashboard/"))["missing_odometer"] == 0
    refused(office.driver.post("/api/odometer/", {"reading_km": 17100}), "already recorded")
    assert ok(office.driver.get("/api/dashboard/"))["odometer"]["reading_km"] == 17000

    assert run_jobs()["alert_service_due"] == "1"
    alert = next(a for a in alerts(office.mto) if a["title"] == f"Service due: {registration}")
    assert alert["link"] == f"/mto/vehicles/{office.vehicle['id']}"
    due = ok(office.mto.get("/api/service-due/"))
    assert [(row["registration_number"], row["km_since"]) for row in due] == [(registration, 5000)]
    assert ok(office.mto.get("/api/dashboard/"))["services_due"] == 1
    assert run_jobs()["alert_service_due"] == "0"  # once per service cycle
    assert alert_titles(office.mto).count(f"Service due: {registration}") == 1

    # The MTO records the service: nothing is due any more and a new cycle begins.
    ok(
        office.mto.post(
            f"/api/vehicles/{office.vehicle['id']}/services/",
            {"service_date": today_ist().isoformat(), "odometer_km": 17000, "notes": "Oil and filters."},
        ),
        201,
    )
    assert ok(office.mto.get("/api/service-due/")) == []
    status = ok(office.mto.get(f"/api/vehicles/{office.vehicle['id']}/service-status/"))
    assert (status["due"], status["next_due_km"]) == (False, 22000)


# --- a driver may pick any pump in AP --------------------------------------------------------------------------------
def test_a_driver_may_fill_at_a_tie_up_bunk_of_another_office(pto, office):
    other = open_office(pto, "Guntur MTO", "GNT", GUNTUR, "mto.guntur", "AP2002")
    bunk = add_pump(other, "Krishna Fuel Point", "TIE_UP", "16.310000", "80.440000")
    add_staff(other.mto, bunk, "pump.gnt.tieup", "Krishna bunk staff")
    guntur_bunk = login("pump.gnt.tieup")

    filled = fill(office, bunk, guntur_bunk, "25")

    assert (filled["pump_name"], filled["litres_filled"]) == ("Krishna Fuel Point", "25.00")
    assert quota(office.mto, office.vehicle)["used_litres"] == "25.00"
    assert [row["litres_filled"] for row in ok(guntur_bunk.get("/api/fuel/pump-fills/"))] == ["25.00"]
    assert ok(office.bunk.get("/api/fuel/pump-fills/")) == []
    assert other.mto.get(f"/api/vehicles/{office.vehicle['id']}/").status_code == 404  # the vehicle stays private
