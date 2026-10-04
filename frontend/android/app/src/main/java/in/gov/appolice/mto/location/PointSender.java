package in.gov.appolice.mto.location;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

/** Sends a batch of locations to the trip on the server, signed in with the device token, as the app does. */
final class PointSender {

    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;
    /** More than any answer to a batch needs; the rest is not read. */
    private static final int MAX_ANSWER_BYTES = 16 * 1024;

    /** What to do, and the server's message, if it gave one. */
    static final class Result {
        final Answer answer;
        final String detail;

        Result(Answer answer, String detail) {
            this.answer = answer;
            this.detail = detail;
        }
    }

    private PointSender() {}

    /** Waits for the network: never on the main thread. */
    static Result send(Trip trip, List<Fix> batch) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) trip.pointsUrl.openConnection();
            connection.setRequestMethod("POST");
            connection.setInstanceFollowRedirects(false); // the token goes to the server's address and nowhere else
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setUseCaches(false);
            connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", trip.authorization);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/json");
            byte[] body = Fix.batch(batch).getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            int status = connection.getResponseCode();
            String detail = status >= 400 ? detail(connection.getErrorStream()) : null;
            return new Result(Answer.of(status, detail), detail);
        } catch (IOException | RuntimeException e) {
            return new Result(Answer.of(Answer.NO_ANSWER, null), null);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    /** The "detail" the server explains a refusal with, or null. */
    private static String detail(InputStream answer) {
        if (answer == null) {
            return null;
        }
        try (InputStream in = answer) {
            ByteArrayOutputStream read = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int n;
            while (read.size() < MAX_ANSWER_BYTES && (n = in.read(chunk)) != -1) {
                read.write(chunk, 0, n);
            }
            Object detail = new JSONObject(read.toString("UTF-8")).opt("detail");
            return detail instanceof String ? (String) detail : null;
        } catch (IOException | JSONException e) {
            return null;
        }
    }
}
