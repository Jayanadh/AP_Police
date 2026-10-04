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
- Keeps the lists of districts, designations and cadres: adds, renames and switches values off, and deletes a value
  nothing uses yet (one in use can only be switched off).
- Watches every office, read only: the state dashboard, every office's **vehicles, officers and drivers**, the
  **fuel statement** by office and every pump's **bunk statement**.

### MTO: office admin (one login per MTO office)
- **Drivers:** add, pause, terminate (no PTO approval).
- **Vehicles:** add, pause (no PTO approval); terminate (**needs PTO approval**).
- **Officers:** create (**needs PTO approval**); ask another office for one of its officers (transfer).
- **Links** each vehicle to its officer and its driver, and reads each vehicle's link history (drivers and officers
  apart).
- **Pumps:** adds police pumps and tie-up bunks in the office's own district, and logins for their staff; sets each
  police pump tank's **opening stock**, once.
- **Live tracking:** sees on a map where the office's vehicles are while their drivers share their live location;
  picks the vehicles to show, and tracks one to follow it and see its route.
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
- **Raises fuel requests:** picks the pump (any police pump or tie-up bunk in AP that can fill the vehicle's fuel
  now) and gets a PIN that works only there.
- **Shares the live location** while on duty: starts it with the duty particulars, stops it on return.
- Writes the **duty particulars** within 2 days of every fill.
- Enters the vehicle's **odometer reading every Sunday**: a whole number, never below the last reading.
- Sees their own fills in a **fuel statement**: litres filled, fills and emergency litres, and where and when each
  fill was (no vehicle number: it is always theirs). The same for an officer.

### Pump staff

| Police pump (state-owned) | Tie-up bunk (private) |
|---|---|
| Sees the requests drivers raised for this pump; picks one, enters the driver's PIN to see the litres, fills exactly those | The same |
| Adds stock when a tanker refills the pump (the MTO set the opening stock once) | No stock tracking |
| Stock goes down automatically with every fill; each fuel's entries for any period, in Excel too | — |
| Fuel statement: one list of fills (vehicle, litres, date and time, officer), searched by vehicle or officer; and how each tank's stock moved | Fuel statement: the same list of fills |

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
| Tie-up bunk | Vehicles waiting to be filled, today's fills and litres |

Alerts are in the app only (the bell at the top right of every page). Every statement and monitoring list, and a
vehicle's link history, downloads as an Excel file. Downloads and Log out ask before they go ahead. Litres and stock
are typed with up to two decimals, never below zero.

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
  DRIVER        Picks the pump and the litres needed. Offered: every tie-up bunk in AP that sells the
    │           vehicle's fuel, and every police pump that has it in stock
    ▼
  SYSTEM        Checks: vehicle active · driver linked · pump open and selling the vehicle's fuel ·
    │           a police pump holding the litres asked for · litres within this month's limit
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
                  • Officer / driver: their own fills: litres, pump, when, duty particulars
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
  Once            The MTO sets each tank's opening stock (petrol and diesel) on the pump's page
  Tanker refill   Pump staff add the litres received → stock goes up
  Every fill      Automatic → stock goes down
  Below 100 L     Alert to the pump staff and the MTO (petrol and diesel are checked separately)
  None left       Drivers are not offered the pump for that fuel; asking for more than it holds is refused
```

Tie-up bunks are private: the system keeps no stock for them, and they are offered for every fuel they sell.

### Live location

```
  DRIVER        Live location → Start → enters the duty particulars → OK
    │
    ▼
  PHONE         Shares where the vehicle is: a location after every 25 m moved, and at least once a
    │           minute. Without signal the locations wait on the phone and go once it is back.
    ▼
  MTO           Live tracking: the office's drivers, those sharing on the map with how long ago each
    │           was seen. Picks the vehicles to show; tracks one to follow it and see its route.
    ▼
  DRIVER        Stop on return (Log out stops it too)
                  • no location for 12 hours → sharing stops by itself, and the driver is told
                  • the driver is unlinked from the vehicle → sharing stops
                  • a route is kept for 90 days after its trip ends, then deleted
```

Only the MTO of the vehicle's office sees a trip. The web app shares while it is open on screen (it keeps the
screen on where the browser allows it); a phone pauses web pages in the background. The Android and iPhone apps
share in the background through the same API: with the screen locked and other apps in front, and the Android app
also once it is closed, until the trip ends. A location another app sets (a mock location) is refused. See
[mobile-apps.md](mobile-apps.md).

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
