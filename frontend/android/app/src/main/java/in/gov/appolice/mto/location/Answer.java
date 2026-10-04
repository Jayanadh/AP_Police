package in.gov.appolice.mto.location;

/** What to do after the server answered a batch of locations (tracking/views.py, points). */
enum Answer {
    /** Kept: off the waiting list. */
    TAKEN,
    /** The server will never take these, as when the phone's clock is far off: off the list, and carry on. */
    REFUSED,
    /** The trip has ended (stopped on another device, the driver unlinked, or it is gone): stop sharing. */
    ENDED,
    /** The sign-in no longer works (signed out, the password changed or reset, the person paused): stop sharing. */
    SIGNED_OUT,
    /** No answer, or the server is busy: keep them and try again with the next send. */
    RETRY;

    /** The status when no answer came at all (no connection, a timeout). */
    static final int NO_ANSWER = -1;

    /** How the server's refusal of a batch for an ended trip begins (tracking/services.py, record_points). */
    private static final String TRIP_ENDED = "This trip has ended.";

    /** The answer from its HTTP status and the "detail" message the server gave with it, if any. */
    static Answer of(int status, String detail) {
        if (status >= 200 && status < 300) {
            return TAKEN;
        }
        if (status == 401 || status == 403) {
            return SIGNED_OUT;
        }
        if (status == 404) {
            return ENDED;
        }
        if (status == 400) {
            return detail != null && detail.startsWith(TRIP_ENDED) ? ENDED : REFUSED;
        }
        return RETRY;
    }
}
