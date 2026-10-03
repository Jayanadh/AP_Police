# AP Police MTO Platform: Design

One web app, for phone and desktop, to manage Andhra Pradesh Police vehicles and fuel across every MTO office.
Built with Angular (screens), a Django REST API (server) and PostgreSQL (database). How to run it is in the
[README](../README.md).

---

## 1. Big picture

```
                        ┌──────────────────────┐
                        │  PTO  (Super Admin)  │
                        └──────────┬───────────┘
                                   │  creates MTO offices
                                   │  approves new officers and vehicle terminations
                                   │  watches every office (read only)
                ┌──────────────────┼───────────────────┐
                ▼                  ▼                   ▼
         ┌─────────────┐    ┌─────────────┐     ┌─────────────┐
         │  MTO office │    │  MTO office │ ... │  MTO office │
         │  (Nellore)  │    │   (Guntur)  │     │             │
         └──────┬──────┘    └─────────────┘     └─────────────┘
                │  each MTO manages only its own office
    ┌───────────┼─────────────┬────────────────┐
    ▼           ▼             ▼                ▼
Officers    Vehicles       Drivers           Pumps
                                       ┌───────┴───────┐
                                       ▼               ▼
                                  Police pump     Tie-up bunk
                                 (state-owned)     (private)
```

### The vehicle is the centre

```
            Officer             ← one officer per vehicle
               │                  (an officer can have several vehicles)
               ▼
      ┌─────────────────┐
      │     VEHICLE     │       monthly fuel limit · odometer · service
      └─────────────────┘
               ▲
               │
            Driver              ← one driver per vehicle
```

---

## 2. Personas: who can do what

Every police person in the system has a name, Emp ID, designation, district and cadre. Pump staff of tie-up bunks are
private employees and need only a name and a login.

### PTO: Super Admin (state level)
- Creates MTO offices and each office's MTO login. The login belongs to the office (the "chair"): when the MTO officer
  changes, the PTO hands the same login over to the new person.
- Approves or rejects **new officers** that an MTO creates, and **vehicle terminations** that an MTO requests.
- Keeps the lists of districts, designations and cadres: adds, renames and switches values off.
- Watches every office, read only: the state dashboard, every office's **vehicles, officers and drivers**, the
  **fuel statement** by office and every pump's **bunk statement**.

### MTO: office admin (one login per MTO office)
- **Drivers:** add, pause, terminate (no PTO approval).
- **Vehicles:** add, pause (no PTO approval); terminate (**needs PTO approval**).
- **Officers:** create (**needs PTO approval**); ask another office for one of its officers (transfer).
- **Links** each vehicle to its officer and its driver, and reads each vehicle's link history (drivers and officers
  apart).
- **Pumps:** adds police pumps and tie-up bunks, and logins for their staff.
- **Fuel:** sets each vehicle's monthly limit; adds **additional quota** for this month or next (quantity, approved
  by and the approval letter are all required).
- **Emergency fills:** allows them; they count against the current month's additional quota, which may go negative.
- **Bunk statements:** reads every fill made at each of the office's pumps, for any period.
- **Alerts:** emergency fills · pump stock below 100 L · duty particulars not written · Sunday odometer missing ·
  service due.
- Sees the office's dashboard and **fuel statement**.

### Officer
- Sees their vehicles, the drivers on them, and their MTO.
- Sees the fuel used by their vehicles in a **fuel statement**, with the duty particulars.
- View only: can't change anything.

### Driver
- **Raises fuel requests:** picks the pump (any police pump or tie-up bunk in AP) and gets a PIN that works only
  there.
- Writes the **duty particulars** within 2 days of every fill.
- Enters the vehicle's **odometer reading every Sunday**.
- Sees their own fills in a **fuel statement**.

### Pump staff

| Police pump (state-owned) | Tie-up bunk (private) |
|---|---|
| Sees the requests drivers raised for this pump; picks one, enters the driver's PIN to see the litres, fills exactly those | The same |
| Records the stock every morning (petrol and diesel) | No stock tracking |
| Adds stock when a tanker refills the pump | — |
| Stock goes down automatically with every fill | — |
| Fuel statement: the fills, and how each tank's stock moved | Fuel statement: the fills |

### Approvals at a glance

| MTO wants to… | Needs PTO approval? |
|---|---|
| Add an officer | **Yes** |
| Terminate a vehicle | **Yes** |
| Add or pause a vehicle | No |
| Add, pause or terminate a driver | No |
| Transfer an officer | No (the officer's current office accepts or rejects it) |

### Each persona's dashboard

| Persona | Sees at a glance |
|---|---|
| PTO | All MTO offices: fuel used vs limits, pumps low on stock, pending approvals |
| MTO | Own office: vehicles, fuel used vs limits, pump stock, alerts |
| Officer | Own vehicles: limit, used and left this month; recent fills |
| Driver | Litres left this month, current PIN, duty particulars still due |
| Police pump | Vehicles waiting to be filled, petrol and diesel stock, today's fills |
| Tie-up bunk | Vehicles waiting to be filled, today's fills, litres filled this month |

Alerts are in the app only (the bell at the top right of every page). Every statement and monitoring list, and a
vehicle's link history, downloads as an Excel file.

---

## 3. The flow

```
  ┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
  │ 1. SETUP             │     │ 2. DAILY FUEL        │     │ 3. STATEMENTS        │
  │ PTO creates office   │ ──► │ Driver picks a pump, │ ──► │ Every fill is on     │
  │ MTO adds vehicles,   │     │ asks, gets a PIN     │     │ record: fuel and     │
  │ drivers, officers,   │     │ That pump fills it   │     │ bunk statements for  │
  │ pumps, fuel limits   │     │ Driver adds duty     │     │ any period, in Excel │
  │                      │     │ particulars (2 days) │     │ too                  │
  └──────────────────────┘     └──────────────────────┘     └──────────────────────┘
```

### Step 1: Setup (once per office)

```
  PTO           Creates the MTO office and its MTO login
    │
    ▼
  MTO           Adds vehicles and drivers (no approval needed)
    │
    ▼
  MTO           Creates officers ──► PTO approves ──► officer can log in
    │
    ▼
  MTO           Links each vehicle to its officer and driver
    │
    ▼
  MTO           Adds pumps (police / tie-up) and logins for the pump staff
    │
    ▼
  MTO           Sets each vehicle's monthly fuel limit
```

### Step 2: Getting fuel (every day)

```
  DRIVER        Picks the pump (any police pump or tie-up bunk in AP) and the litres needed
    │
    ▼
  SYSTEM        Checks: vehicle active · driver linked · pump open and selling the vehicle's fuel ·
    │           litres within this month's limit
    │             • within limit → gives a 6-digit PIN (valid 24 hours, single use, only at that pump)
    │             • over limit   → emergency fuel (see section 4)
    ▼
  PUMP STAFF    See the request in their pump's incoming list (vehicle, driver, fuel; not the litres)
    │
    ▼
  PUMP STAFF    Pick it and enter the driver's PIN → the litres show → fill exactly those litres
    │             • a wrong PIN counts; the fifth cancels the request
    │             • police pump → stock goes down (alert below 100 L)
    ▼
  DRIVER        Writes the duty particulars within 2 days
                  • not done in 2 days → alert to the driver and the MTO (never blocks new requests)
```

### Step 3: Statements

```
  PUMPS         Nothing to send: a fill is always exactly the litres the driver asked for, so the
    │           system's record is the statement. There are no disputes.
    ▼
  MTO / PTO     Read the bunk statement of any of their pumps: every fill (vehicle, date, fuel,
    │           litres) in a period, with totals
    ▼
  EVERYONE      Reads a fuel statement for any day, week (Monday to Sunday), month,
                financial year (April to March) or custom dates up to a year
                  • PTO: by office, then one office's vehicles, pumps and fills
                  • MTO: the office's vehicles, pumps and fills, with duty particulars
                  • Officer / driver: their own vehicles' / their own fills
                  • Police pump: the fills and each tank's stock movement
                  • Tie-up bunk: the fills
                Each statement downloads as an Excel file (vehicle, date, fuel, litres first).
```

Monthly limits start again on the first of every month (Asia/Kolkata).

---

## 4. Other flows

### Emergency fuel (over the monthly limit)

```
  DRIVER        This month's limit is used up, but fuel is needed for duty
    │
    ▼
  DRIVER        Marks the request EMERGENCY and gives the reason (mandatory)
    │             • up to 10 L extra per vehicle per month
    ▼
  PUMP STAFF    Fills the fuel straight away; no waiting for approval
    │
    ▼
  MTO           Gets an alert and allows it: the emergency litres count against this
                month's additional quota (which can go below zero)
```

### Additional fuel (with a letter)

```
  OFFICER       Has an approval letter for extra fuel
    │
    ▼
  MTO           Searches the vehicle number, enters the quantity and who approved it,
    │           and uploads the letter (all three required)
    ▼
  SYSTEM        That vehicle's limit for the month goes up
```

### Police pump stock

```
  Every morning   Pump staff measure the stock (petrol and diesel) → stock is set
  Tanker refill   Pump staff add the litres received → stock goes up
  Every fill      Automatic → stock goes down
  Below 100 L     Alert to the pump staff and the MTO (petrol and diesel are checked separately)
```

### Officer transfer

```
  NEW MTO       Asks the officer's current office for them
    │
    ▼
  OLD MTO       Accepts it (or rejects it)
    │
    ▼
  SYSTEM        The officer moves to the new office. Their vehicle links end, so the old
                office can link those vehicles to other officers.
```

### Vehicle care

```
  Every Sunday    Driver enters the odometer reading → MTO tracks km for each vehicle
  Monday          Alert to the driver and the MTO if Sunday's reading is missing
  Service due     Every X km or Y days, whichever comes first → alert to the MTO
```

### Status of people and vehicles

```
  Driver     Active ⇄ Paused → Terminated
  Officer    Waiting for PTO → Active ⇄ Paused → Terminated   (or Rejected by the PTO)
  Vehicle    Active ⇄ Paused → Waiting for PTO → Terminated   (if the PTO says no, it goes back)
```
