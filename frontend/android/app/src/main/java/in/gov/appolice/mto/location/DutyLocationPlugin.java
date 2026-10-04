package in.gov.appolice.mto.location;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * Live location in the Android app (location-source.ts): the same calls as the background geolocation plugin the iOS
 * app uses (addWatcher, removeWatcher, openSettings), and carryOn, which gives the service the trip to send to by
 * itself once the app is closed. See DutyLocationService.
 */
@CapacitorPlugin(
        name = "DutyLocation",
        permissions = {
            @Permission(
                    alias = "location",
                    strings = {Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION})
        })
public class DutyLocationPlugin extends Plugin {

    private static final String NOT_AUTHORIZED = "NOT_AUTHORIZED";
    private static final String UNAVAILABLE = "UNAVAILABLE";

    /** What to do with the service once connected to it, on the main thread. */
    private interface Use {
        void with(DutyLocationService.Link service);
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Use> pending = new ArrayList<>();
    private DutyLocationService.Link service;
    private boolean bound;

    private final ServiceConnection connection =
            new ServiceConnection() {
                @Override
                public void onServiceConnected(ComponentName name, IBinder binder) {
                    service = (DutyLocationService.Link) binder;
                    for (Use use : pending) {
                        use.with(service);
                    }
                    pending.clear();
                }

                @Override
                public void onServiceDisconnected(ComponentName name) {
                    service = null;
                }
            };

    @Override
    public void load() {
        DutyLocationService.makeChannel(getContext());
        // Bound for as long as the app's screen lives; a service sharing on its own is picked up again.
        bound =
                getContext()
                        .bindService(
                                new Intent(getContext(), DutyLocationService.class),
                                connection,
                                Context.BIND_AUTO_CREATE);
    }

    /** Passes each location to the callback, until removeWatcher. Asks for the precise location first. */
    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void addWatcher(PluginCall call) {
        call.setKeepAlive(true);
        if (preciseLocationAllowed()) {
            startWatching(call);
        } else if (Boolean.TRUE.equals(call.getBoolean("requestPermissions", true))) {
            requestPermissionForAlias("location", call, "afterLocationPermission");
        } else {
            call.reject("Precise location is not allowed for this app.", NOT_AUTHORIZED);
        }
    }

    @PermissionCallback
    private void afterLocationPermission(PluginCall call) {
        if (preciseLocationAllowed()) {
            startWatching(call);
        } else {
            call.reject("Precise location is not allowed for this app.", NOT_AUTHORIZED);
        }
    }

    private void startWatching(PluginCall call) {
        String title = call.getString("backgroundTitle");
        String text = call.getString("backgroundMessage");
        String id = call.getCallbackId();
        main.post(
                () -> {
                    if (!DutyLocationService.isSharing()) {
                        try {
                            ContextCompat.startForegroundService(
                                    getContext(), DutyLocationService.intent(getContext(), title, text));
                        } catch (RuntimeException e) {
                            call.reject("Live location could not start.", UNAVAILABLE);
                            return;
                        }
                    }
                    whenConnected(
                            service ->
                                    service.watch(
                                            id,
                                            new DutyLocationService.Watcher() {
                                                @Override
                                                public void onFix(Fix fix) {
                                                    call.resolve(toJs(fix));
                                                }

                                                @Override
                                                public void onProblem(String code) {
                                                    call.reject("No location just now.", code);
                                                }
                                            }));
                    if (!locationOn()) {
                        call.reject("Location is off on this phone.", UNAVAILABLE);
                    }
                });
    }

    @PluginMethod
    public void removeWatcher(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("Missing id.");
            return;
        }
        main.post(() -> whenConnected(service -> service.unwatch(id)));
        PluginCall watching = getBridge().getSavedCall(id);
        if (watching != null) {
            watching.release(getBridge());
        }
        call.resolve();
    }

    /** The trip to send to by itself once the app is closed: {trip, api, token}. */
    @PluginMethod
    public void carryOn(PluginCall call) {
        Trip trip = Trip.from(call.getInt("trip"), call.getString("api"), call.getString("token"));
        if (trip == null) {
            call.reject("The trip, the server's address and the sign-in are needed.");
            return;
        }
        main.post(() -> whenConnected(service -> service.carryOn(trip)));
        call.resolve();
    }

    /** Opens the phone's settings for the app, where location can be allowed again. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent settings =
                new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.fromParts("package", getContext().getPackageName(), null));
        getContext().startActivity(settings);
        call.resolve();
    }

    /** The app's screen is closing (swiped away, or closed by Android): the service carries on alone, or stops. */
    @Override
    protected void handleOnDestroy() {
        if (service != null) {
            service.appClosed();
        }
        if (bound) {
            getContext().unbindService(connection);
            bound = false;
        }
        service = null;
        pending.clear();
        super.handleOnDestroy();
    }

    private void whenConnected(Use use) {
        if (service != null) {
            use.with(service);
        } else {
            pending.add(use);
        }
    }

    /** Fine location: an approximate one (a kilometre or more off) is no use to the office. */
    private boolean preciseLocationAllowed() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressWarnings("deprecation")
    private boolean locationOn() {
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return manager.isLocationEnabled();
        }
        return Settings.Secure.getInt(
                        getContext().getContentResolver(), Settings.Secure.LOCATION_MODE, Settings.Secure.LOCATION_MODE_OFF)
                != Settings.Secure.LOCATION_MODE_OFF;
    }

    /** As the background geolocation plugin passes a location, so the app reads both alike. */
    private static JSObject toJs(Fix fix) {
        JSObject location = new JSObject();
        location.put("latitude", fix.latitude);
        location.put("longitude", fix.longitude);
        location.put("time", fix.time);
        location.put("accuracy", fix.accuracy != null ? fix.accuracy : JSONObject.NULL);
        location.put("speed", fix.speed != null ? fix.speed : JSONObject.NULL);
        location.put("bearing", fix.heading != null ? fix.heading : JSONObject.NULL);
        location.put("altitude", JSONObject.NULL);
        location.put("altitudeAccuracy", JSONObject.NULL);
        location.put("simulated", false);
        return location;
    }
}
