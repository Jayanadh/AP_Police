package in.gov.appolice.mto.location;

import java.net.MalformedURLException;
import java.net.URL;
import java.util.regex.Pattern;

/**
 * The trip the service sends to by itself once the app is closed: where its locations go on the server, and the
 * device token that signs them in. It comes from the app's web layer, so it is checked before it is used.
 */
final class Trip {

    /** A device token as the server makes them (secrets.token_urlsafe): nothing that could break the request. */
    private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_-]{20,200}");

    final URL pointsUrl;
    final String authorization;

    private Trip(URL pointsUrl, String authorization) {
        this.pointsUrl = pointsUrl;
        this.authorization = authorization;
    }

    /**
     * The trip, or null unless all is sound: its number, the server's address (http or https, with nothing after the
     * host and port) and the token.
     */
    static Trip from(Integer id, String api, String token) {
        if (id == null || id <= 0 || api == null || token == null || !TOKEN.matcher(token).matches()) {
            return null;
        }
        String base = api.endsWith("/") ? api.substring(0, api.length() - 1) : api;
        try {
            URL server = new URL(base);
            String scheme = server.getProtocol();
            boolean web = "https".equals(scheme) || "http".equals(scheme); // plain http only where the build allows it
            if (!web
                    || server.getHost().isEmpty()
                    || server.getUserInfo() != null
                    || !server.getPath().isEmpty()
                    || server.getQuery() != null
                    || server.getRef() != null) {
                return null;
            }
            return new Trip(new URL(base + "/api/tracking/trips/" + id + "/points/"), "Bearer " + token);
        } catch (MalformedURLException e) {
            return null;
        }
    }
}
