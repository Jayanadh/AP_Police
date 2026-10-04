package in.gov.appolice.mto.location;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class FixTest {

    /** 2026-10-04 04:30:05.250 UTC, 10:00:05 in India. */
    private static final long TIME = 1_791_088_205_250L;

    @Test
    public void writesTheLocationAsTheServerTakesIt() {
        Fix fix = new Fix(14.4426, 79.9865, TIME, 6.5, 11.25, 90.0);

        assertEquals(
                "{\"latitude\":14.4426,\"longitude\":79.9865,\"recorded_at\":\"2026-10-04T04:30:05.250Z\","
                        + "\"accuracy\":6.5,\"speed\":11.25,\"heading\":90.0}",
                fix.toJson());
    }

    @Test
    public void leavesOutWhatThePhoneDoesNotKnow() {
        Fix fix = new Fix(-33.5, -70.25, TIME, null, null, null);

        assertEquals(
                "{\"latitude\":-33.5,\"longitude\":-70.25,\"recorded_at\":\"2026-10-04T04:30:05.250Z\","
                        + "\"accuracy\":null,\"speed\":null,\"heading\":null}",
                fix.toJson());
    }

    @Test
    public void dropsFiguresOutsideWhatTheServerTakes() {
        Fix fix = new Fix(14.4426, 79.9865, TIME, -1.0, 151.0, Double.NaN);

        assertNull(fix.accuracy);
        assertNull(fix.speed);
        assertNull(fix.heading);
        assertNull(new Fix(14.4426, 79.9865, TIME, 100_001.0, -0.5, 360.5).accuracy);
        assertEquals(Double.valueOf(360.0), new Fix(14.4426, 79.9865, TIME, null, null, 360.0).heading);
    }

    @Test
    public void measuresTheDistanceToAnotherLocation() {
        Fix nellore = new Fix(14.4426, 79.9865, TIME, null, null, null);
        Fix north = new Fix(14.4526, 79.9865, TIME, null, null, null); // 0.01 degrees of latitude

        assertEquals(1112, nellore.metresTo(north), 1);
    }

    @Test
    public void writesABatch() {
        Fix one = new Fix(14.0, 79.0, TIME, null, null, null);
        Fix two = new Fix(14.5, 79.5, TIME + 5000, null, null, null);

        assertEquals("{\"points\":[" + one.toJson() + "," + two.toJson() + "]}", Fix.batch(Arrays.asList(one, two)));
        assertEquals("{\"points\":[]}", Fix.batch(Collections.<Fix>emptyList()));
    }
}
