package in.gov.appolice.mto.location;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AnswerTest {

    @Test
    public void takenWhenTheServerKeptThem() {
        assertEquals(Answer.TAKEN, Answer.of(200, null));
    }

    @Test
    public void endedWhenTheTripHasEndedOrIsGone() {
        assertEquals(Answer.ENDED, Answer.of(400, "This trip has ended. Stopped by the driver."));
        assertEquals(Answer.ENDED, Answer.of(400, "This trip has ended. The driver is no longer linked to AP39PA1001."));
        assertEquals(Answer.ENDED, Answer.of(404, "Not found."));
    }

    @Test
    public void refusedWhenTheServerWillNeverTakeThem() {
        assertEquals(Answer.REFUSED, Answer.of(400, "A location's time is outside this trip. Check the phone's clock."));
        assertEquals(Answer.REFUSED, Answer.of(400, null));
    }

    @Test
    public void signedOutWhenTheSignInNoLongerWorks() {
        assertEquals(Answer.SIGNED_OUT, Answer.of(401, "Sign in again."));
        assertEquals(Answer.SIGNED_OUT, Answer.of(403, "Sign in again."));
        assertEquals(Answer.SIGNED_OUT, Answer.of(403, "Change your password before you continue."));
    }

    @Test
    public void triedAgainWhenThereWasNoAnswerOrTheServerIsBusy() {
        assertEquals(Answer.RETRY, Answer.of(Answer.NO_ANSWER, null));
        assertEquals(Answer.RETRY, Answer.of(429, "Request was throttled."));
        assertEquals(Answer.RETRY, Answer.of(500, null));
        assertEquals(Answer.RETRY, Answer.of(502, null));
        assertEquals(Answer.RETRY, Answer.of(302, null));
    }
}
