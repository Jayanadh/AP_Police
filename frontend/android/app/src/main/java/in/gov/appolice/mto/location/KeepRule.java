package in.gov.appolice.mto.location;

/**
 * Which locations are worth sending, as Live location in the app decides (live-location.ts): one once the vehicle has
 * moved 25 m, but not sooner than 5 seconds after the last, and at least one a minute, moving or not. A vague one
 * (could be over 100 m off) only as that minute's.
 */
final class KeepRule {

    private static final double MOVE_METRES = 25;
    private static final long MIN_GAP_MS = 5_000;
    private static final long HEARTBEAT_MS = 60_000;
    private static final double VAGUE_METRES = 100;

    private Fix last;

    /** Whether to keep this location; a kept one is what the next is measured from. */
    boolean keep(Fix fix) {
        if (last != null) {
            long gap = fix.time - last.time;
            if (gap < HEARTBEAT_MS
                    && (gap < MIN_GAP_MS
                            || (fix.accuracy != null && fix.accuracy > VAGUE_METRES)
                            || last.metresTo(fix) < MOVE_METRES)) {
                return false;
            }
        }
        last = fix;
        return true;
    }

    /** Starts again: the next location is kept. */
    void reset() {
        last = null;
    }
}
