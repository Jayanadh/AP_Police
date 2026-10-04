# The Android and iPhone apps

The same Angular app, wrapped with **Capacitor** into an Android app and an iPhone app. Every screen is the web app's,
so there is one code base for the web, Android and iOS. What the apps add is live location in the background: a
driver's phone keeps sharing with the screen locked and other apps in front, and the Android app also once the app
is closed.

---

## 1. What differs from the web app

| | Web app | Android app | iPhone app |
|---|---|---|---|
| Sign-in | Session cookie | **Device token**, kept encrypted with the Android Keystore | **Device token**, kept in the iOS Keychain |
| Server | The page's own (`/api/…`) | The server's full HTTPS address, over the phone's own HTTP | The same |
| Live location | While the page is open on screen (the screen is kept on) | The app's own **foreground service**, with a notification: goes on with the screen locked, other apps in front, **and the app closed** | The background location plugin: goes on with the screen locked and other apps in front; stops if the app is swiped away, until it is opened again (Apple's rule for every app) |
| A location set by another app (mock location) | Not detectable | Refused, and the driver is told | Refused (iOS 15 and later), and the driver is told |
| Excel downloads | Saved by the browser | Offered with the phone's share sheet | The same |

---

## 2. Live location in the apps

```
  DRIVER        Live location → Start → duty particulars → OK
    │           The app asks for the precise location (and, on Android 13+, for notifications)
    ▼
  PHONE         The location service starts: "Sharing live location" shows in the notifications
    │           (Android) or the location sign in the status bar (iPhone)
    ▼
  APP OPEN      Live location keeps a location after every 25 m moved, at least one a minute, and
    │           sends them every 15 seconds; without signal they wait on the phone
    ▼
  APP CLOSED    Android: the service carries on by itself with the same rule, and sends to the trip
    │           with the device token. Opened again, the app takes over what is still waiting.
    │           iPhone: sharing pauses until the app is opened again
    ▼
  ENDS          The driver presses Stop (or Log out) in the app
                  • the trip ended on the server (stopped on another device, the driver unlinked,
                    12 hours with no location) → the service stops and says so in a notification
                  • the sign-in no longer works (password changed or reset, paused) → the same
```

The MTO's **Live tracking** shows each sharing vehicle with how long ago it was last seen, so a phone that stopped
sharing shows up as "Last seen 20 min ago".

### Tried on the Android emulator (Android 15)

| Case | What happened |
|---|---|
| Screen locked for 8 minutes | A batch every 15 seconds throughout |
| Forced deep sleep (Doze) | The same |
| App swiped away from the recent apps, screen locked | The service carried on: a batch every 15 seconds, and the MTO's map followed the vehicle |
| No network for a minute with the app closed | The locations waited on the phone and arrived once the network was back: no gap in the route |
| App opened again | The app took over sharing, with the route so far |
| Trip ended on the server while the app was closed | The service stopped and showed "Live location stopped: This trip has ended. Stopped by the driver." |
| A mock location app set the location | Nothing was sent; the app said another app is setting the location |
| Stop | The trip ended and the notification went away |

The iPhone app is built from the same code but has not been run here: building it needs a Mac with Xcode. Try it on
a real iPhone before handing it out (section 6).

### Limits to tell drivers about

- **Some phone makers stop apps to save battery** even while they show a notification (Xiaomi, Redmi and POCO;
  OPPO, Realme and OnePlus; Vivo and iQOO; some Samsung models). On those phones, in the app's settings: set
  **Battery** to **No restrictions** (or **Unrestricted**), and turn **Autostart** on where the phone has it.
- If Android ends the app altogether (a phone maker's battery saver, **Force stop**, an app update, the phone
  restarting), sharing pauses until the driver opens the app. The open trip is then picked up by itself.
- On the iPhone, swiping the app away stops sharing until it is opened again.
- Location must be **precise**: an approximate location (a kilometre or more off) is refused, with a button to the
  app's settings.

---

## 3. Permissions

### Android

| Permission | Why | Asked |
|---|---|---|
| Location, precise, "While using the app" | Live location | When the driver presses Start |
| Notifications (Android 13 and later) | The "Sharing live location" notification | When the driver presses Start |
| Foreground service, of type location | Sharing with the screen locked and the app closed | No question: declared in the app |
| Internet | The API | No question |

The app needs no "Allow all the time" permission: the service is started from the screen. Other settings in
`frontend/android/app/src/main/AndroidManifest.xml`:

- No backups and no transfer to another phone: the sign-in stays on the phone.
- HTTPS only, trusting only the phone's own certificate authorities (`res/xml/network_security_config.xml`). Debug
  builds also allow plain HTTP to the emulator's address for the development server (`src/debug/`).
- The live location service cannot be started by any other app.

### iPhone

`frontend/ios/App/App/Info.plist`: why the location is needed (`NSLocationWhenInUseUsageDescription`,
`NSLocationAlwaysAndWhenInUseUsageDescription`), and `UIBackgroundModes` with `location`. When the driver presses
Start, the iPhone asks to allow the location while using the app, and may later offer **Always**; either lets the app
share in the background, with the blue location sign in the status bar. **Precise Location** must stay on for the
app (Settings → Privacy & Security → Location Services → AP Police MTO).

---

## 4. Building the apps

You need Node (as for the web app). For Android: JDK 21 and the Android SDK (platform 35), most easily through
**Android Studio**, on Windows, macOS or Linux. For the iPhone: a Mac with **Xcode** and **CocoaPods**, and an Apple
developer account.

1. Put the server's HTTPS address in `frontend/src/environments/environment.mobile.ts` (now the placeholder
   `https://mto.example.gov.in`). Its certificate must come from a public certificate authority, as Let's Encrypt's
   do: the apps do not trust a department's own.
2. Build the app's pages and copy them into the native project:

   ```bash
   cd frontend
   npm run build:android
   npm run build:ios
   ```

   `build:ios` runs `pod install`, which needs Xcode. If CocoaPods warns about UTF-8, run `export LANG=en_US.UTF-8`
   first.
3. **Android:** `npm run open:android` opens the project in Android Studio. **Build → Generate Signed App Bundle or
   APK** makes the release. The first time, it creates the signing key: keep that key and its passwords safe and off
   the server, because every update must be signed with the same key.
4. **iPhone:** `npm run open:ios` opens Xcode. Pick your team under **Signing & Capabilities**, then **Product →
   Archive**.

The app's ID is `in.gov.appolice.mto` (`frontend/capacitor.config.ts`). Change it before the first release if the
department uses another.

### Where the code is

| Path | What |
|---|---|
| `frontend/capacitor.config.ts` | The apps' settings |
| `frontend/src/app/core/native.ts`, `device-token.ts` | The server's address, and the device token in the phone's secure storage |
| `frontend/src/app/core/location-source.ts` | Where locations come from: the browser, the Android service or the iPhone plugin |
| `frontend/src/app/core/live-location.ts` | Live location: what is kept, when it is sent, what is shown |
| `frontend/android/app/src/main/java/in/gov/appolice/mto/location/` | The Android live location service, and its tests in `src/test/` |

---

## 5. Trying it on the Android emulator

```bash
# The server, also answering the emulator (which reaches this computer at 10.0.2.2)
cd backend
source .venv/bin/activate
DJANGO_ALLOWED_HOSTS="localhost,127.0.0.1,10.0.2.2" python manage.py runserver

# The app, built for the emulator, installed on it
cd frontend
npm run build:emulator
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

To drive, move the emulator's location: `adb emu geo fix 79.9865 14.4426` (longitude first), again every few
seconds with new figures. To swipe the app away, open the recent apps and swipe it up; the notification stays and
the MTO's map keeps following the vehicle.

The Android service's tests: `cd frontend/android && ./gradlew testDebugUnitTest`.

---

## 6. Before handing the apps out

1. Try both apps on real phones: an hour with the screen locked; the app swiped away; no signal, then signal; the
   phone restarted during a trip; the driver unlinked during a trip; Log out while sharing.
2. **Google Play** (or your department's device management): the Play Console asks for a declaration of the
   foreground service of type location, with a short video of Start and Stop, and for the location and data safety
   forms. Google raises the required Android version every year; a later release may need Capacitor 8.
3. **App Store** (or Apple Business Manager, to keep the app to the department): review asks why the app uses the
   location in the background. Duty tracking of the department's own staff, while they choose to share, fits.

---

## 7. The API the apps use

### Signing in with a device token

`POST /api/auth/token/` with `{"username": "...", "password": "...", "device_name": "Android phone"}` answers
`201` with `{"token": "...", "expires_at": "...", "user": {...}}`. The token is shown only this once.

- Wrong details are refused as on the web login, with the same limits: 10 tries a minute from one address, 20 an hour
  for one login ID.
- A person can have five devices signed in; signing in on a sixth signs the oldest out.
- A token stops working after 30 days, on Log out, when the person's password is changed on another device or reset
  by the MTO or PTO, and when the person is paused or terminated. Every call then answers `403` with
  `{"detail": "Sign in again."}`, and the app shows its login.
- A person who must change their password can, until they do, only read who they are, change the password and log
  out: other calls answer `403` with `{"detail": "Change your password before you continue."}`.
- The server keeps only the token's SHA-256, never the token itself.

Every other call is the web app's, with `Authorization: Bearer <token>`.

### Live location

| Call | Who | Answer |
|---|---|---|
| `GET /api/tracking/trips/current/` | Driver | `{"trip": {...}}`, or `{"trip": null}` when not sharing |
| `POST /api/tracking/trips/` with `{"duty_particulars": "..."}` | Driver | `201` and the trip |
| `POST /api/tracking/trips/<id>/points/` with `{"points": [...]}` | Driver, own trip | `{"accepted": 3, "trip": {...}}` |
| `POST /api/tracking/trips/<id>/stop/` | Driver, own trip | The trip, ended |
| `GET /api/tracking/trips/<id>/path/?after=<cursor>` | The driver, or the MTO of the vehicle's office | `{"trip", "points", "cursor", "more"}`: the route kept since the last answer |
| `GET /api/tracking/live/` | MTO | Every driver of the office, their vehicle, and their trip if sharing |

A location is `{"latitude": 14.4426, "longitude": 79.9865, "recorded_at": "2026-10-04T10:30:05+05:30", "accuracy": 8,
"speed": 11.2, "heading": 90}`: the time the phone took it, with its time zone; accuracy in metres, speed in metres a
second and heading in degrees may be left out.

- At most 200 locations in a batch, and 30 batches a minute for one driver.
- Each location's time must fall within the trip: from 2 minutes before it started to 2 minutes past the server's
  clock. A batch from a phone with a wrong clock is refused with "A location's time is outside this trip. Check the
  phone's clock."
- A location the server already has is ignored, so sending a batch again after a lost answer is safe.
- Once a trip has ended, batches are refused with "This trip has ended." and the reason; the app (or the Android
  service, with the app closed) stops sharing and says why.
- A trip is open to the driver and to the MTO of the vehicle's office only; to anyone else it does not exist (`404`).
