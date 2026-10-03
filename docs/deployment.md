# Deploying AP Police MTO on a Linux server

This is the plan for running the app for real users on one Linux server. It is written for **Ubuntu Server 24.04 LTS**;
Debian 12 is the same apart from where noted, and RHEL, Rocky or AlmaLinux 9 are covered in
[section 9](#9-on-rhel-rocky-or-almalinux-9). Every command is run as a user with `sudo`.

## 1. What runs where

```
  Browser ──HTTPS──► nginx (ports 80, 443)
                      ├── /         the built Angular app (static files in /srv/mto/www)
                      └── /api/     ──► gunicorn on 127.0.0.1:8000 (Django, runs as the user "mto")
                                         ├── PostgreSQL on 127.0.0.1:5432 (database "mto")
                                         └── /var/lib/mto/media (uploaded approval letters)

  systemd timers: mto-jobs (every hour: PIN expiry, overdue duty particulars, odometer, service due)
                  mto-backup (every night: database and letters)
```

- Only nginx is reachable from outside. Django and PostgreSQL listen on the server itself.
- Approval letters are **never** served as plain files. They go through the API, which checks who is asking.
- The Django admin is off.

| Path | What | Owner |
|---|---|---|
| `/srv/mto` | the code (a git checkout of this repository) | root |
| `/srv/mto/backend/.venv` | the Python environment | root |
| `/srv/mto/www` | the built frontend | root |
| `/etc/mto/mto.env` | the settings, including secrets | root, mode 600 |
| `/var/lib/mto/media` | uploaded approval letters | mto, mode 750 |
| `/var/backups/mto` | nightly backups | root, mode 700 |

The code belongs to root and the app's user can only read it, so a compromised app cannot rewrite itself.

## 2. Before you start

- **Server:** 2 CPUs, 4 GB RAM and 40 GB disk are plenty for a state's offices. Add disk for letters and backups.
- **Name:** a host name such as `mto.example.gov.in` pointing at the server. Replace it everywhere below.
- **Certificate:** either Let's Encrypt (the server must be reachable on port 80 from the internet) or a
  certificate from your department's IT team.
- **Clock:** PINs expire after 24 hours and alerts are timed, so the clock must be right. Check that
  `timedatectl` says "System clock synchronized: yes". The app works in India time whatever the server's time zone.
- **Map tiles:** the maps use the public OpenStreetMap tile servers. Their usage policy does not cover heavy official
  use. Before going live, ask your IT team for a tile service (your own, or a paid one) and change `TILES` in
  `frontend/src/app/ui/map-view.ts` and `img-src` in the nginx header below to match.

## 3. Install the server software

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git python3.12 python3.12-venv postgresql nginx certbot python3-certbot-nginx ufw rsync
```

On Debian 12 the system Python is 3.11; install Python 3.12 from your usual source first, as the app needs 3.12.

Node is only needed to **build** the frontend. Install Node 24 LTS on the server, or build on another machine and copy
the result (step 6):

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
```

Firewall: SSH and web traffic only.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

The user the app runs as, and its folders:

```bash
sudo useradd --system --home-dir /var/lib/mto --shell /usr/sbin/nologin mto
sudo install -d -o mto -g mto -m 750 /var/lib/mto /var/lib/mto/media
sudo install -d -m 755 /srv/mto /srv/mto/www
sudo install -d -m 700 /etc/mto /var/backups/mto
```

## 4. The database

Ubuntu's PostgreSQL (16) listens only on the server itself, which is what we want. Create the database user with a
long random password (the command asks for it) and its database:

```bash
sudo -u postgres createuser --pwprompt mto
sudo -u postgres createdb --owner mto mto
```

Keep the password; it goes into the settings file next.

## 5. The code and the settings

```bash
sudo git clone <your repository URL> /srv/mto
sudo python3.12 -m venv /srv/mto/backend/.venv
sudo /srv/mto/backend/.venv/bin/pip install --upgrade pip
sudo /srv/mto/backend/.venv/bin/pip install -r /srv/mto/backend/requirements.txt
sudo /srv/mto/backend/.venv/bin/python -m compileall -q /srv/mto/backend
```

Make a secret key:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(50))"
```

Create `/etc/mto/mto.env` with `sudo nano /etc/mto/mto.env`. Every variable is explained in the README's
**Settings** section.

```ini
DJANGO_SECRET_KEY=<the key you just made>
DJANGO_DEBUG=0
DJANGO_ALLOWED_HOSTS=mto.example.gov.in
DJANGO_CSRF_TRUSTED_ORIGINS=https://mto.example.gov.in
# nginx is the one proxy in front of Django
DJANGO_PROXY_COUNT=1
DJANGO_SSL_REDIRECT=1
DJANGO_HSTS_SECONDS=31536000
DJANGO_ADMIN=0
DJANGO_MEDIA_ROOT=/var/lib/mto/media
POSTGRES_DB=mto
POSTGRES_USER=mto
POSTGRES_PASSWORD=<the database password>
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
```

```bash
sudo chmod 600 /etc/mto/mto.env
```

A small helper runs Django's management commands as the `mto` user with these settings. Create
`/usr/local/bin/mto-manage`:

```sh
#!/bin/sh
# Run a Django management command for AP Police MTO, as the app's user, with the server's settings.
set -eu
set -a
. /etc/mto/mto.env
set +a
cd /srv/mto/backend
exec runuser -u mto -- /srv/mto/backend/.venv/bin/python manage.py "$@"
```

```bash
sudo chmod 755 /usr/local/bin/mto-manage
```

Create the tables, check the production settings, and make the first login, the state PTO. The PTO then adds the
districts, designations and cadres under **Master lists**, and the MTO offices. Never run `seed_demo` here: it is for
demos and refuses to run when `DJANGO_DEBUG=0`.

```bash
sudo mto-manage migrate
sudo mto-manage check --deploy
sudo mto-manage create_pto --username pto --full-name "State PTO"
```

`check --deploy` must end with "System check identified no issues (2 silenced)". The two silenced checks are HSTS
for subdomains and HSTS preloading, left off on purpose.

## 6. Build the frontend

```bash
cd /srv/mto/frontend
sudo npm ci
sudo npx ng build
sudo rsync -a --delete /srv/mto/frontend/dist/frontend/browser/ /srv/mto/www/
```

Building elsewhere works the same: run `npm ci` and `npx ng build` there, then copy `dist/frontend/browser/` into
`/srv/mto/www/` on the server.

## 7. Run the app with systemd

`/etc/systemd/system/mto.service`, the API. One worker per CPU plus one is a good start.

```ini
[Unit]
Description=AP Police MTO API (gunicorn)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=mto
Group=mto
EnvironmentFile=/etc/mto/mto.env
WorkingDirectory=/srv/mto/backend
ExecStart=/srv/mto/backend/.venv/bin/gunicorn config.wsgi:application \
    --bind 127.0.0.1:8000 --workers 3 --timeout 60 --access-logfile -
Restart=on-failure

# The app may write only its letters folder.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/mto/media
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/mto-jobs.service` and `/etc/systemd/system/mto-jobs.timer`: the scheduled jobs, every hour. They
are safe to run as often as you like.

```ini
[Unit]
Description=AP Police MTO scheduled jobs

[Service]
Type=oneshot
User=mto
Group=mto
EnvironmentFile=/etc/mto/mto.env
WorkingDirectory=/srv/mto/backend
ExecStart=/srv/mto/backend/.venv/bin/python manage.py run_scheduled_jobs
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/mto/media
```

```ini
[Unit]
Description=Run the AP Police MTO scheduled jobs every hour

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mto.service mto-jobs.timer
sudo systemctl status mto.service
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: mto.example.gov.in" -H "X-Forwarded-Proto: https" http://127.0.0.1:8000/api/health/
```

The last command prints `200` when the API is up.

## 8. nginx and HTTPS

Get the certificate first, while nginx still has its default site:

```bash
sudo certbot certonly --nginx -d mto.example.gov.in --deploy-hook "systemctl reload nginx"
```

With a certificate from your IT team instead, put its files somewhere such as `/etc/ssl/mto/` and use those paths
below.

`/etc/nginx/sites-available/mto`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name mto.example.gov.in;
    return 301 https://$host$request_uri;
}

server {
    # nginx 1.25 and later prefer "listen 443 ssl;" with "http2 on;"; this form works on 1.24 (Ubuntu 24.04) too.
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name mto.example.gov.in;

    ssl_certificate     /etc/letsencrypt/live/mto.example.gov.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mto.example.gov.in/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;

    server_tokens off;
    root /srv/mto/www;
    index index.html;
    # Approval letters are at most 5 MB.
    client_max_body_size 6m;

    # Only the app's own scripts run; map tiles come from OpenStreetMap (change it with the tile service).
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "same-origin" always;
    add_header Permissions-Policy "geolocation=(self), camera=(), microphone=()" always;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        # Replace whatever the client sent: login throttling counts attempts by this address.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Built files carry a hash in their name and never change: browsers may keep them for a year.
    location ~* "-[A-Za-z0-9_]{8}\.(?:js|css)$" {
        expires 1y;
        access_log off;
    }

    # The app's page is always read fresh, so a new version shows at once.
    location = /index.html {
        expires -1;
    }

    # Every other address is a page of the app.
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

The policy above was tried against the production build: the pages, styles, map and logins all work with it.
Keep `add_header` lines only in the `server` block. nginx drops them for any `location` that adds its own.

```bash
sudo ln -s /etc/nginx/sites-available/mto /etc/nginx/sites-enabled/mto
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Open `https://mto.example.gov.in`, log in as the PTO, and change the password under **Profile** if a colleague typed
it. Let's Encrypt certificates renew by themselves (`systemctl list-timers` shows `certbot.timer`).

## 9. On RHEL, Rocky or AlmaLinux 9

The same plan, with these differences:

- Packages: `sudo dnf install -y git python3.12 nginx rsync`, PostgreSQL 16 from the `postgresql:16` module or the
  PostgreSQL project's repository (`postgresql-setup --initdb`, then start it), and certbot from EPEL.
- The app's user: `useradd --system --home-dir /var/lib/mto --shell /sbin/nologin mto`.
- PostgreSQL's `pg_hba.conf` may need `scram-sha-256` (not `ident`) for local TCP connections of the `mto` user.
- nginx reads `/etc/nginx/conf.d/mto.conf`; there is no `sites-enabled`.
- Firewall: `sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload`.
- SELinux: let nginx reach gunicorn and read the frontend:
  `sudo setsebool -P httpd_can_network_connect 1` and `sudo restorecon -R /srv/mto/www`
  (or `chcon -R -t httpd_sys_content_t /srv/mto/www`).

## 10. Backups

`/usr/local/bin/mto-backup`, run every night by a timer. It keeps 14 days on the server. Copy `/var/backups/mto` to
another machine as well: a backup on the same disk does not survive the disk.

```sh
#!/bin/sh
# Back up the AP Police MTO database and approval letters; keep 14 days.
set -eu
day=$(date +%F)
dir=/var/backups/mto
runuser -u postgres -- pg_dump --format=custom mto > "$dir/db-$day.dump"
tar -czf "$dir/letters-$day.tar.gz" -C /var/lib/mto media
find "$dir" -type f -mtime +14 -delete
```

`/etc/systemd/system/mto-backup.service` and `/etc/systemd/system/mto-backup.timer`:

```ini
[Unit]
Description=Back up AP Police MTO

[Service]
Type=oneshot
ExecStart=/usr/local/bin/mto-backup
```

```ini
[Unit]
Description=Back up AP Police MTO every night

[Timer]
OnCalendar=*-*-* 02:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo chmod 700 /usr/local/bin/mto-backup
sudo systemctl daemon-reload
sudo systemctl enable --now mto-backup.timer
sudo systemctl start mto-backup.service && ls -l /var/backups/mto
```

To restore (stop the app first, so nothing writes meanwhile):

```bash
sudo systemctl stop mto.service mto-jobs.timer
sudo -u postgres pg_restore --clean --if-exists --dbname mto /var/backups/mto/db-<date>.dump
sudo tar -xzf /var/backups/mto/letters-<date>.tar.gz -C /var/lib/mto
sudo systemctl start mto.service mto-jobs.timer
```

Try a restore on a spare machine once, before you need it.

## 11. Installing a new version

```bash
cd /srv/mto
sudo git pull
sudo /srv/mto/backend/.venv/bin/pip install -r backend/requirements.txt
sudo /srv/mto/backend/.venv/bin/python -m compileall -q backend
sudo mto-manage migrate
cd frontend && sudo npm ci && sudo npx ng build
sudo rsync -a --delete /srv/mto/frontend/dist/frontend/browser/ /srv/mto/www/
sudo systemctl restart mto.service
sudo mto-manage check --deploy
```

Take a backup (`sudo systemctl start mto-backup.service`) before any version with database changes. Users keep their
sessions across a restart.

## 12. Logs and problems

| To see | Run |
|---|---|
| The API's requests and errors | `sudo journalctl -u mto -f` |
| The last scheduled jobs | `sudo journalctl -u mto-jobs --since today` |
| Web traffic | `sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log` |
| When the timers run next | `systemctl list-timers 'mto*'` |

| Problem | Likely cause |
|---|---|
| `mto.service` does not start: "Set DJANGO_SECRET_KEY when DJANGO_DEBUG=0" | `/etc/mto/mto.env` is missing the key or still says `change-me`. |
| "DJANGO_DEBUG=1 is for development" | `DJANGO_DEBUG` is not `0` in the settings file. |
| 502 Bad Gateway | gunicorn is not running: `systemctl status mto` and its log. |
| 400 Bad Request on every page of the API | The host name is not in `DJANGO_ALLOWED_HOSTS`. |
| Logging in says "CSRF Failed" | `DJANGO_CSRF_TRUSTED_ORIGINS` does not match the `https://` address users open. |
| Endless redirects | nginx is not sending `X-Forwarded-Proto`, or `DJANGO_PROXY_COUNT` is `0`. |
| Uploading a letter fails with 413 | `client_max_body_size` in nginx is below 6m. |
| The map is grey | The tile service is blocked by the network or missing from the `img-src` header. |

## 13. Security checklist

- [ ] `DJANGO_DEBUG=0`, a fresh random `DJANGO_SECRET_KEY`, and `/etc/mto/mto.env` readable by root only.
- [ ] `sudo mto-manage check --deploy` reports no issues.
- [ ] PostgreSQL and gunicorn listen only on `127.0.0.1` (`sudo ss -tlnp` shows them on 127.0.0.1 alone).
- [ ] The firewall allows only SSH, 80 and 443; SSH uses keys, not passwords.
- [ ] HTTPS works and `http://` redirects to it; the certificate renews by itself.
- [ ] The Django admin stays off (`DJANGO_ADMIN=0`). If it is ever needed, allow it only from the office network.
- [ ] No demo data on the server: no `seed_demo`, and no `Demo-pass-2026` logins.
- [ ] Backups run every night and are copied off the server; a restore has been tried.
- [ ] `sudo apt upgrade` (or `dnf upgrade`) is run regularly, and the app is updated when new versions come out.
- [ ] The tile service and the use of both emblems are approved by your department.
