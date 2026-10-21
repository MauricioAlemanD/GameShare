package dev.gameshare.backend.support;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** Cliente HTTP mínimo para las pruebas de integración. */
public final class ApiClient {

    public record Response(int status, JsonNode body, HttpResponse<String> raw) {
        public String text(String field) {
            return body.path(field).asString();
        }
    }

    public static final ObjectMapper JSON = JsonMapper.builder().build();
    private final HttpClient http = HttpClient.newHttpClient();
    private final String base;

    public ApiClient(int port) {
        this.base = "http://localhost:" + port;
    }

    public Response call(String method, String path, String token, Object body, Map<String, String> headers) {
        try {
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + path));
            if (token != null) {
                b.header("Authorization", "Bearer " + token);
            }
            headers.forEach(b::header);
            if (body instanceof String raw) {
                b.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(raw));
            } else if (body != null) {
                b.header("Content-Type", "application/json")
                        .method(method, HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)));
            } else {
                b.method(method, HttpRequest.BodyPublishers.noBody());
            }
            HttpResponse<String> res = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
            JsonNode node;
            try {
                node = res.body() == null || res.body().isBlank() ? JSON.nullNode() : JSON.readTree(res.body());
            } catch (tools.jackson.core.JacksonException notJson) {
                node = JSON.getNodeFactory().stringNode(res.body()); // p. ej., "Invalid CORS request"
            }
            return new Response(res.statusCode(), node, res);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public Response post(String path, String token, Object body) {
        return call("POST", path, token, body, Map.of());
    }

    public Response get(String path, String token) {
        return call("GET", path, token, null, Map.of());
    }

    public Response put(String path, String token, Object body) {
        return call("PUT", path, token, body, Map.of());
    }

    public Response delete(String path, String token) {
        return call("DELETE", path, token, null, Map.of());
    }

    // ---- atajos del flujo típico

    public record Party(String sessionId, String participantId, String token) {
    }

    public Party createSession(String name) {
        Response r = post("/api/sessions", null, Map.of("displayName", name));
        if (r.status() != 201) {
            throw new IllegalStateException("createSession " + r.status() + " " + r.body());
        }
        return new Party(r.text("sessionId"), r.text("participantId"), r.text("token"));
    }

    public String createInvite(Party host) {
        Response r = post("/api/sessions/" + host.sessionId() + "/invites", host.token(), null);
        if (r.status() != 201) {
            throw new IllegalStateException("createInvite " + r.status() + " " + r.body());
        }
        return r.text("code");
    }

    public Party redeem(String code, String name) {
        Response r = post("/api/invites/redeem", null, Map.of("code", code, "displayName", name));
        if (r.status() != 201) {
            throw new IllegalStateException("redeem " + r.status() + " " + r.body());
        }
        return new Party(r.text("sessionId"), r.text("participantId"), r.text("token"));
    }

    public Response approve(Party host, Party guest) {
        return post("/api/sessions/" + host.sessionId() + "/participants/" + guest.participantId() + "/approve",
                host.token(), null);
    }
}
