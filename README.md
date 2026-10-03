# AP Police MTO Platform

One web app, for phone and desktop, to manage AP Police vehicles and fuel across every MTO office. The PTO (state head office) creates MTO offices; each MTO office manages its own officers, drivers, vehicles and fuel pumps; drivers pick a pump, ask for fuel and get a PIN; the request waits at that pump, where its staff enter the PIN and fill exactly the litres asked for. The design, with the personas, business rules and flows, is in [`docs/design.md`](docs/design.md).

Built with Angular (screens), Django REST Framework (API) and PostgreSQL (database).

## What you need installed

- **Docker** (runs the PostgreSQL 17 database)
- **Python 3.12**
- **Node 24 LTS** (comes with npm)

## First-time setup

Run these once. Start in the repository's top folder (the one that contains `docker-compose.yml`).

```bash
# 1. Start the database (leave it running; it keeps your data between restarts)
docker compose up -d db

# 2. Backend: Python environment, tables and demo data
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python manage.py migrate
python manage.py seed_demo
cd ..

# 3. Frontend: install packages
cd frontend
npm install
cd ..
```

`seed_demo` creates two MTO offices (Nellore and Guntur) with officers, drivers, vehicles and pumps, and prints the logins. It also adds last month's fills at the two tie-up bunks, so the statements have something to show (only on a database with no fills yet). It is safe to run again: it never duplicates anything and it puts the demo passwords back.

## Running the app

Open two terminal windows.

**Terminal 1: the backend (API on port 8000)**

```bash
cd backend
source .venv/bin/activate
python manage.py runserver
```

**Terminal 2: the frontend (screens on port 4200)**

```bash
cd frontend
npm start
```

Then open **http://localhost:4200** and log in with one of the demo logins below. The frontend forwards every `/api` request to the backend on `localhost:8000` (see `frontend/proxy.conf.json`), so there is nothing else to configure.

## Demo logins

Every demo login uses the password **`Demo-pass-2026`**. Type the login ID in the "Emp ID or login ID" box.

| Login ID | Who | Things to try |
|---|---|---|
| `pto` | PTO, the state super admin | Dashboard of both offices; MTO offices; Approvals (new officers and vehicle terminations that MTO offices ask for); Vehicles, Officers and Drivers of every office (read only, with filters); Fuel statement by office; Bunk statements of every office's pumps; Master lists (districts, designations, cadres: add, rename, switch off). Every statement and list downloads as Excel. The approvals list starts empty: add an officer or ask to terminate a vehicle as an MTO, then come back here. |
| `mto.nellore` | MTO chair, SPSR Nellore MTO | Dashboard; Vehicles `AP39PA1001` and `AP39PA1002`; add a driver, officer or vehicle; Additional quota (quantity, approved by and the letter are all required); Emergencies; Pumps and the map; Fuel statement; Bunk statements (every fill at a pump in any period; last month's at Sri Venkateswara Fuels has three); a vehicle's link history, drivers and officers on their own tabs; Odometer; Servicing; Transfers. |
| `mto.guntur` | MTO chair, Guntur MTO | Same screens for a second office. Its police pump starts with diesel below 100 L, so a low-stock alert is waiting under Alerts. In Transfers, ask for officer `AP3001`, then log in as `mto.nellore` to accept or reject. |
| `ap3001`, `ap3002` | Officers in Nellore | View only: their vehicle (`AP39PA1001` for `ap3001`, `AP39PA1002` for `ap3002`), the driver on it, fuel limit, used and left this month, and the fuel statement with duty particulars. |
| `ap3101` | Officer in Guntur | View only: vehicle `AP07PB2001`, its driver and fuel. |
| `ap4001`, `ap4002` | Drivers in Nellore (diesel jeep and car) | Home shows litres left this month; Pumps finds police pumps and tie-up bunks on a map; Fuel: pick the pump (or start from one in Pumps), ask for litres and get the 6-digit PIN (valid 24 hours, single use, only at that pump); ask for more than is left to try an emergency request; fill in duty particulars after a fill; Odometer takes the Sunday reading; Fuel statement lists their own fills. |
| `ap4101` | Driver in Guntur (petrol car) | The same screens for `AP07PB2001`. |
| `pump.nlr.police` | Staff, Nellore DPO Police Pump | Dashboard with petrol and diesel stock and how many vehicles are waiting; Fill: pick a waiting vehicle, enter the driver's PIN to see the litres, and fill exactly those; Stock: record the morning measurement or a tanker delivery. Every fill lowers the stock automatically. Fuel statement shows the fills and how each tank's stock moved. |
| `pump.gnt.police` | Staff, Guntur Police Pump | Same, with diesel starting under the 100 L warning level. |
| `pump.nlr.tieup` | Staff, Sri Venkateswara Fuels (tie-up bunk, Nellore) | Fill, as at a police pump; Fuel statement: every fill made at the bunk. No stock screen, because tie-up bunks do not track stock. |
| `pump.gnt.tieup` | Staff, Krishna Fuel Point (tie-up bunk, Guntur, petrol only) | Same as the other tie-up bunk. |

A good first walk-through. Windows of one browser share their login, and so do its private windows, so logging in as a second person logs the first one out. Either log out and back in as each person in turn, or use one normal window, one private window and a second browser:

1. As `ap4001`, open **Fuel**, pick **Nellore DPO Police Pump** and request some litres. Note the PIN.
2. As `pump.nlr.police`, open **Fill**, pick `AP39PA1001` under **Waiting at this pump**, enter the PIN, check it, and press **Fill**. Stock goes down.
3. Back as `ap4001`, add the duty particulars for that fill.
4. As `mto.nellore`, open **Fuel statement** or **Bunk statements** to see the fill (and download it as Excel), and **Dashboard** for the stock and alerts.

Every statement page has the same period picker: **Day**, **Week** (Monday to Sunday), **Month**, **Year** (the financial year, April to March) or **Custom** dates, up to a year. The arrows step back and forth but never into the future.

## Scheduled jobs

Some alerts are raised by time passing, not by a click: unused PINs expiring, duty particulars not filled within 48 hours, a missing Sunday odometer reading, and service due. One command runs all of them and is safe to run as often as you like:

```bash
cd backend
source .venv/bin/activate
python manage.py run_scheduled_jobs
```

It prints one line per job with the number of records it acted on. To run it every hour, add this line to `crontab -e` (replace `<repo>` with the full path to this folder):

```
0 * * * * cd <repo>/backend && .venv/bin/python manage.py run_scheduled_jobs
```

## Tests

```bash
# Backend (the database container must be running)
cd backend
source .venv/bin/activate
pytest

# Frontend
cd frontend
npx ng test --watch=false
npx ng build
```

## Settings

The backend reads these environment variables. Every one has a development default, so none are needed on a laptop. `backend/.env.example` lists them for reference; nothing loads that file, so export them in your shell or process manager.

| Variable | Default | Meaning |
|---|---|---|
| `DJANGO_SECRET_KEY` | development key | **Required when `DJANGO_DEBUG=0`**: the server refuses to start with the development key or the `change-me` placeholder from `.env.example`. |
| `DJANGO_DEBUG` | `1` | Set to `0` for a real server. This makes the session and CSRF cookies HTTPS-only, redirects plain HTTP to HTTPS and sends HSTS, so the server must be served over HTTPS. With `1` the server refuses to start for any host that is not this machine or the local network. `seed_demo` also refuses to run when it is off, unless you add `--force`. |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Comma-separated host names the server answers to. |
| `DJANGO_PROXY_COUNT` | `0` | How many reverse proxies (such as nginx) stand in front of Django. With `1` or more, the client address for login throttling comes from `X-Forwarded-For` and HTTPS from `X-Forwarded-Proto`; with `0` both come from the connection, so a client cannot fake them. |
| `DJANGO_SSL_REDIRECT` | `1` | When `DJANGO_DEBUG=0`: set to `0` if the proxy in front already redirects HTTP to HTTPS. |
| `DJANGO_HSTS_SECONDS` | `31536000` | When `DJANGO_DEBUG=0`: how long browsers must use HTTPS only (one year). It covers this host only, not other sites under the same domain. |
| `DJANGO_ADMIN` | `1` with debug, else `0` | Set to `1` to serve the Django admin at `/admin/` in production. |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `http://localhost:4200` | Comma-separated origins allowed to submit forms. |
| `DJANGO_MEDIA_ROOT` | `backend/media` | Where uploaded approval letters are stored. |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT` | `mto`, `mto`, `mto`, `localhost`, `5432` | Database connection. |

The database container only listens on `127.0.0.1`, and its `mto` password is for development. Use a strong password and your own database for anything that holds real data.

## Deploying on a Linux server

[`docs/deployment.md`](docs/deployment.md) is the step-by-step plan for one Ubuntu, Debian or RHEL-family server:
PostgreSQL, gunicorn and the scheduled jobs under systemd, nginx with HTTPS and security headers, nightly backups,
updates, and a security checklist. On a new server the first login is made with
`python manage.py create_pto --username pto --full-name "State PTO"`, which asks for the password twice.

## Project layout

```
backend/                Django REST API
  config/               settings, URLs
  accounts/             users, roles, login, officer transfers, the create_pto command
  masters/              districts, designations, cadres
  fleet/                vehicles, officer/driver links, odometer, servicing
  approvals/            PTO approvals
  pumps/                pumps, tanks, stock ledger
  fuel/                 fuel requests, PINs, fills at the chosen pump, quota, statements, Excel exports
  notifications/        in-app alerts
  dashboards/           dashboard figures for each role
  common/               shared helpers (periods, Excel files), seed_demo and run_scheduled_jobs commands
  testing/              test factories
  tests_e2e/            end-to-end API flow tests
frontend/               Angular app
  src/app/core/         API access, sign-in state, helpers
  src/app/layout/       app bar, side menu and bottom navigation
  src/app/ui/           shared building blocks (buttons, cards, map, downloads, toasts, sign-in scene)
  src/app/features/     one folder per role (pto, mto, officer, driver, pump) plus the shared
                        alerts, auth, profile and fuel statement screens
  public/               favicon, home-screen icon, and the AP Police and Government of AP emblems
docs/design.md          the design: personas, rules and flows
docs/deployment.md      how to run it on a Linux server
docker-compose.yml      the PostgreSQL database
```

## If something goes wrong

- **Login says the details are wrong:** run `python manage.py seed_demo` again in `backend/`; it resets the demo passwords.
- **The page loads but shows errors:** check the backend window is running on port 8000 and the database container is up (`docker compose ps`).
- **Port 5432 is already in use:** another PostgreSQL is already running on your machine. Stop that one, then run `docker compose up -d db` again.
- **Start with empty data:** `docker compose down -v` removes the database and its data; then repeat the first-time setup from `docker compose up -d db`.
