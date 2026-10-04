package in.gov.appolice.mto.location;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class TripTest {

    /** As the server makes them: secrets.token_urlsafe(32). */
    private static final String TOKEN = "Zr8C0bq3N0x4WQ-7dYv_kT2mJ9sLp1aHcE5uB6nRgFo";

    @Test
    public void sendsToTheTripsPointsOnTheServer() {
        Trip trip = Trip.from(5, "https://mto.example.gov.in", TOKEN);

        assertEquals("https://mto.example.gov.in/api/tracking/trips/5/points/", trip.pointsUrl.toString());
        assertEquals("Bearer " + TOKEN, trip.authorization);
    }

    @Test
    public void takesTheAddressWithAPortOrAClosingSlash() {
        assertEquals(
                "http://10.0.2.2:8000/api/tracking/trips/12/points/",
                Trip.from(12, "http://10.0.2.2:8000/", TOKEN).pointsUrl.toString());
    }

    @Test
    public void refusesAnythingButAWebAddress() {
        assertNull(Trip.from(5, "file:///data/data/in.gov.appolice.mto/files", TOKEN));
        assertNull(Trip.from(5, "content://in.gov.appolice.mto.fileprovider/x", TOKEN));
        assertNull(Trip.from(5, "javascript:alert(1)", TOKEN));
        assertNull(Trip.from(5, "https://", TOKEN));
        assertNull(Trip.from(5, "not an address", TOKEN));
        assertNull(Trip.from(5, "https://mto.example.gov.in/api", TOKEN)); // the server's address only
        assertNull(Trip.from(5, "https://user:secret@mto.example.gov.in", TOKEN));
        assertNull(Trip.from(5, "https://mto.example.gov.in?next=/", TOKEN));
        assertNull(Trip.from(5, null, TOKEN));
    }

    @Test
    public void refusesAMissingTripOrSignIn() {
        assertNull(Trip.from(null, "https://mto.example.gov.in", TOKEN));
        assertNull(Trip.from(0, "https://mto.example.gov.in", TOKEN));
        assertNull(Trip.from(-3, "https://mto.example.gov.in", TOKEN));
        assertNull(Trip.from(5, "https://mto.example.gov.in", null));
        assertNull(Trip.from(5, "https://mto.example.gov.in", ""));
    }

    @Test
    public void refusesASignInThatCouldBreakTheRequest() {
        assertNull(Trip.from(5, "https://mto.example.gov.in", TOKEN + "\r\nX-Other: 1"));
        assertNull(Trip.from(5, "https://mto.example.gov.in", "has spaces in it, so not a token at all"));
        assertNull(Trip.from(5, "https://mto.example.gov.in", "short"));
    }
}
