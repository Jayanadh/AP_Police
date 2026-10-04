package in.gov.appolice.mto.location;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class KeepRuleTest {

    private static final long START = 1_790_000_000_000L;
    /** About 45 m north of Nellore's centre per step of 0.0004 degrees of latitude. */
    private static final double LAT = 14.4426;
    private static final double LNG = 79.9865;

    private static Fix at(long secondsLater, double latitude, Double accuracy) {
        return new Fix(latitude, LNG, START + secondsLater * 1000, accuracy, null, null);
    }

    @Test
    public void keepsTheFirstLocation() {
        assertTrue(new KeepRule().keep(at(0, LAT, 5.0)));
    }

    @Test
    public void keepsALocationOnceTheVehicleHasMoved25Metres() {
        KeepRule rule = new KeepRule();
        rule.keep(at(0, LAT, 5.0));

        assertFalse(rule.keep(at(10, LAT + 0.0002, 5.0))); // about 22 m
        assertTrue(rule.keep(at(15, LAT + 0.0004, 5.0))); // about 44 m
    }

    @Test
    public void measuresFromTheLastLocationKept() {
        KeepRule rule = new KeepRule();
        rule.keep(at(0, LAT, 5.0));
        rule.keep(at(10, LAT + 0.0004, 5.0));

        assertFalse(rule.keep(at(20, LAT + 0.0005, 5.0))); // 11 m from the last one kept
    }

    @Test
    public void keepsNoneSoonerThanFiveSecondsAfterTheLast() {
        KeepRule rule = new KeepRule();
        rule.keep(at(0, LAT, 5.0));

        assertFalse(rule.keep(at(4, LAT + 0.001, 5.0))); // 110 m away, but only 4 seconds later
        assertTrue(rule.keep(at(5, LAT + 0.001, 5.0)));
    }

    @Test
    public void keepsOneAMinuteWhileStandingStill() {
        KeepRule rule = new KeepRule();
        rule.keep(at(0, LAT, 5.0));

        assertFalse(rule.keep(at(59, LAT, 5.0)));
        assertTrue(rule.keep(at(60, LAT, 5.0)));
    }

    @Test
    public void keepsAVagueLocationOnlyAsTheMinutesOne() {
        KeepRule rule = new KeepRule();
        rule.keep(at(0, LAT, 5.0));

        assertFalse(rule.keep(at(10, LAT + 0.01, 150.0))); // moved 1 km, but could be 150 m off
        assertTrue(rule.keep(at(60, LAT + 0.01, 150.0)));
    }

    @Test
    public void startsAgainAfterAReset() {
        KeepRule rule = new KeepRule();
        rule.keep(at(0, LAT, 5.0));
        rule.reset();

        assertTrue(rule.keep(at(1, LAT, 5.0)));
    }
}
