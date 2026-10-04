package in.gov.appolice.mto.location;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/** One location as the phone took it, with the phone's own time, as the server takes it (tracking/serializers.py). */
final class Fix {

    /** The fastest a location may say the vehicle moves, as the server takes it: 150 m/s. */
    private static final double MAX_SPEED = 150;
    private static final double MAX_ACCURACY = 100_000;
    private static final double EARTH_RADIUS_METRES = 6_371_000;

    final double latitude;
    final double longitude;
    /** When the phone took it, in milliseconds since 1970. */
    final long time;
    /** How far off it may be, in metres; null when not known. */
    final Double accuracy;
    /** Metres a second; null when not known. */
    final Double speed;
    /** Degrees from north; null when not known. */
    final Double heading;

    Fix(double latitude, double longitude, long time, Double accuracy, Double speed, Double heading) {
        this.latitude = latitude;
        this.longitude = longitude;
        this.time = time;
        this.accuracy = within(accuracy, 0, MAX_ACCURACY);
        this.speed = within(speed, 0, MAX_SPEED);
        this.heading = within(heading, 0, 360);
    }

    /** A figure the phone gave, or null when it does not know it (NaN, or out of its range). */
    private static Double within(Double value, double min, double max) {
        return value == null || value.isNaN() || value < min || value > max ? null : value;
    }

    /** Straight-line distance (haversine), as the app measures it (geo.ts). */
    double metresTo(Fix other) {
        double dLat = Math.toRadians(other.latitude - latitude);
        double dLng = Math.toRadians(other.longitude - longitude);
        double h = Math.pow(Math.sin(dLat / 2), 2)
                + Math.cos(Math.toRadians(latitude)) * Math.cos(Math.toRadians(other.latitude))
                        * Math.pow(Math.sin(dLng / 2), 2);
        return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    /** The location in JSON, as one of the points of a batch. Only numbers and the time: nothing to escape. */
    String toJson() {
        return "{\"latitude\":" + latitude
                + ",\"longitude\":" + longitude
                + ",\"recorded_at\":\"" + isoTime(time) + "\""
                + ",\"accuracy\":" + accuracy
                + ",\"speed\":" + speed
                + ",\"heading\":" + heading
                + "}";
    }

    /** A batch of locations as the server takes it: {"points": [...]}. */
    static String batch(List<Fix> fixes) {
        StringBuilder json = new StringBuilder("{\"points\":[");
        for (int i = 0; i < fixes.size(); i++) {
            if (i > 0) {
                json.append(',');
            }
            json.append(fixes.get(i).toJson());
        }
        return json.append("]}").toString();
    }

    /** The time in UTC with milliseconds, as JavaScript's toISOString() writes it. */
    private static String isoTime(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(millis));
    }
}
