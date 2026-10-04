package in.gov.appolice.mto.location;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import in.gov.appolice.mto.R;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/**
 * Live location's foreground service (type "location", with its "Sharing live location" notification), so sharing goes
 * on with the screen locked and other apps in front.
 *
 * <p>While the app is open it passes every location to the app, whose Live location keeps, holds and sends them. Once
 * the app is closed (swiped away from the recent apps, or its screen closed by Android) it carries on by itself: it
 * keeps locations by the same rule and sends them to the trip with the device token, until the trip ends on the
 * server or the app is opened again and takes over what is still waiting.
 *
 * <p>Everything here runs on the main thread, but for the sending, which waits for the network on its own thread.
 */
public class DutyLocationService extends Service {

    /** The app's Live location, while it is open. */
    interface Watcher {
        void onFix(Fix fix);

        /** Why there are no locations just now: "SIMULATED" while another app sets the phone's location. */
        void onProblem(String code);
    }

    static final String SIMULATED = "SIMULATED";
    private static final String CHANNEL = "live_location";
    private static final String TITLE = "title";
    private static final String TEXT = "text";
    private static final int SHARING_NOTE = 1;
    private static final int STOPPED_NOTE = 2;
    /** How often the phone is asked for a location; the keep rule then thins them out. */
    private static final long INTERVAL_MS = 5_000;
    private static final long SEND_EVERY_MS = 15_000;
    /** The most locations the server takes in one batch. */
    private static final int BATCH = 200;
    /** About seven hours of driving without a connection; beyond it the oldest locations go first. */
    private static final int MAX_WAITING = 5_000;
    /** How long it waits, once the app stops watching, for the app to watch again (another trip) before it stops. */
    private static final long LINGER_MS = 3_000;

    /** Whether the service is running in the foreground, so the app need not start it again. */
    private static volatile boolean sharing;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Map<String, Watcher> watchers = new LinkedHashMap<>();
    private final List<Fix> waiting = new ArrayList<>();
    private final KeepRule rule = new KeepRule();
    private final Link link = new Link();
    private final Runnable stopNow = this::finish;
    private final LocationCallback callback =
            new LocationCallback() {
                @Override
                public void onLocationResult(LocationResult result) {
                    for (Location location : result.getLocations()) {
                        took(location);
                    }
                }
            };

    private FusedLocationProviderClient locations;
    private boolean updating;
    private boolean simulating;
    /** Where to send once the app is closed; null until the app's trip is known. */
    private Trip trip;
    /** The app is closed and the service sends by itself. */
    private boolean alone;
    private boolean sending;
    private long lastSendAt;
    /** Moves on whenever the app takes over again, so an answer meant for the service alone is ignored. */
    private int run;

    /** The app's handle on the service. Called on the main thread. */
    final class Link extends Binder {

        /** Starts passing locations to the app; if the service was on its own, the app takes over what waits. */
        void watch(String id, Watcher watcher) {
            main.removeCallbacks(stopNow);
            watchers.put(id, watcher);
            if (alone) {
                alone = false;
                sending = false;
                run++;
                for (Fix fix : waiting) {
                    watcher.onFix(fix);
                }
                waiting.clear();
            }
            startUpdates();
        }

        void unwatch(String id) {
            watchers.remove(id);
            if (watchers.isEmpty() && !alone) {
                main.removeCallbacks(stopNow);
                main.postDelayed(stopNow, LINGER_MS);
            }
        }

        /** The trip to send to by itself once the app is closed. */
        void carryOn(Trip trip) {
            DutyLocationService.this.trip = trip;
        }

        /** The app is closing: carry on by itself if the app was sharing a trip, or stop. */
        void appClosed() {
            DutyLocationService.this.appClosed();
        }
    }

    static boolean isSharing() {
        return sharing;
    }

    /** What starts the service, with what its notification says. */
    static Intent intent(Context context, String title, String text) {
        return new Intent(context, DutyLocationService.class).putExtra(TITLE, title).putExtra(TEXT, text);
    }

    /** The "Live location" notification channel, made once (Android 8 and later). */
    static void makeChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel =
                new NotificationChannel(
                        CHANNEL,
                        context.getString(R.string.live_location_channel),
                        NotificationManager.IMPORTANCE_DEFAULT);
        channel.setShowBadge(false);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        makeChannel(this);
        locations = LocationServices.getFusedLocationProviderClient(this);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return link;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent == null ? null : intent.getStringExtra(TITLE);
        String text = intent == null ? null : intent.getStringExtra(TEXT);
        Notification note =
                note(title == null ? getString(R.string.live_location_sharing) : title, text == null ? "" : text, true);
        try {
            ServiceCompat.startForeground(
                    this,
                    SHARING_NOTE,
                    note,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0);
            sharing = true;
            startUpdates();
        } catch (RuntimeException e) { // location not allowed, or started from the background
            finish();
        }
        return START_NOT_STICKY; // if Android ends the app altogether, sharing waits for the app to be opened again
    }

    /** Swiped away from the recent apps. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        appClosed();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopUpdates();
        network.shutdownNow();
        sharing = false;
        super.onDestroy();
    }

    private void appClosed() {
        if (alone) {
            return;
        }
        if (trip == null || watchers.isEmpty()) {
            finish(); // not sharing a trip: nothing to carry on with
            return;
        }
        watchers.clear();
        alone = true;
        rule.reset();
        lastSendAt = 0;
    }

    private void startUpdates() {
        if (updating || !sharing) {
            return;
        }
        LocationRequest request =
                new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
                        .setMinUpdateIntervalMillis(INTERVAL_MS / 2)
                        .build();
        try {
            locations.requestLocationUpdates(request, callback, Looper.getMainLooper());
            updating = true;
        } catch (SecurityException e) {
            // Location is not allowed (any more): the app asks for it and says so.
        }
    }

    private void stopUpdates() {
        if (updating) {
            locations.removeLocationUpdates(callback);
            updating = false;
        }
    }

    private void took(Location location) {
        if (isSimulated(location)) {
            if (!simulating && !alone) {
                for (Watcher watcher : new ArrayList<>(watchers.values())) {
                    watcher.onProblem(SIMULATED);
                }
            }
            simulating = true;
            return; // another app is setting the phone's location: none of it is the vehicle's
        }
        simulating = false;
        Fix fix =
                new Fix(
                        location.getLatitude(),
                        location.getLongitude(),
                        location.getTime(),
                        location.hasAccuracy() ? (double) location.getAccuracy() : null,
                        location.hasSpeed() ? (double) location.getSpeed() : null,
                        location.hasBearing() ? (double) location.getBearing() : null);
        if (!alone) {
            for (Watcher watcher : new ArrayList<>(watchers.values())) {
                watcher.onFix(fix);
            }
            return;
        }
        if (rule.keep(fix)) {
            waiting.add(fix);
            if (waiting.size() > MAX_WAITING) {
                waiting.subList(0, waiting.size() - MAX_WAITING).clear();
            }
        }
        if (SystemClock.elapsedRealtime() - lastSendAt >= SEND_EVERY_MS) {
            sendWaiting();
        }
    }

    @SuppressWarnings("deprecation")
    private static boolean isSimulated(Location location) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? location.isMock() : location.isFromMockProvider();
    }

    /** Sends the next batch of what waits; the rest follows once it is taken. One batch at a time. */
    private void sendWaiting() {
        if (sending || waiting.isEmpty() || trip == null) {
            return;
        }
        sending = true;
        lastSendAt = SystemClock.elapsedRealtime();
        int thisRun = run;
        Trip to = trip;
        List<Fix> batch = new ArrayList<>(waiting.subList(0, Math.min(BATCH, waiting.size())));
        try {
            network.execute(
                    () -> {
                        PointSender.Result result = PointSender.send(to, batch);
                        main.post(() -> answered(thisRun, batch, result));
                    });
        } catch (RejectedExecutionException e) {
            sending = false; // the service is ending
        }
    }

    private void answered(int thisRun, List<Fix> batch, PointSender.Result result) {
        if (thisRun != run || !alone) {
            return; // the app took over meanwhile, with these locations
        }
        sending = false;
        switch (result.answer) {
            case TAKEN:
            case REFUSED:
                waiting.removeAll(batch);
                sendWaiting();
                break;
            case ENDED:
                stopSaying(result.detail != null ? result.detail : getString(R.string.live_location_ended));
                break;
            case SIGNED_OUT:
                stopSaying(getString(R.string.live_location_sign_in));
                break;
            case RETRY:
                break; // with the next location
        }
    }

    /** Stops sharing, and tells the driver why with a notification of its own. */
    private void stopSaying(String why) {
        finish();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                        == PackageManager.PERMISSION_GRANTED) {
            NotificationManagerCompat.from(this)
                    .notify(STOPPED_NOTE, note(getString(R.string.live_location_stopped), why, false));
        }
    }

    /** Stops the locations and the sending, takes the notification away and ends the service. */
    private void finish() {
        main.removeCallbacks(stopNow);
        stopUpdates();
        watchers.clear();
        waiting.clear();
        trip = null;
        alone = false;
        sending = false;
        simulating = false;
        run++;
        sharing = false;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private Notification note(String title, String text, boolean ongoing) {
        NotificationCompat.Builder note =
                new NotificationCompat.Builder(this, CHANNEL)
                        .setSmallIcon(R.drawable.ic_live_location)
                        .setColor(ContextCompat.getColor(this, R.color.live_location))
                        .setContentTitle(title)
                        .setContentText(text)
                        .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                        .setContentIntent(openApp())
                        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        if (ongoing) {
            note.setOngoing(true)
                    .setSilent(true)
                    .setCategory(NotificationCompat.CATEGORY_SERVICE)
                    .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        } else {
            note.setAutoCancel(true).setCategory(NotificationCompat.CATEGORY_STATUS);
        }
        return note.build();
    }

    /** Opening the notification opens the app. */
    private PendingIntent openApp() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch == null) {
            return null;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return PendingIntent.getActivity(
                this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
