package dev.gameshare.backend.signaling;

import dev.gameshare.backend.api.ApiException;
import dev.gameshare.backend.config.GameShareProperties;
import dev.gameshare.backend.security.TokenBucket;
import dev.gameshare.backend.session.AuthContext;
import dev.gameshare.backend.session.ConnectionStats;
import dev.gameshare.backend.session.SessionEvents;
import dev.gameshare.backend.session.SessionService;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Señalización WebRTC y eventos de sesión por WebSocket ({@code /ws}).
 *
 * <p>Protocolo (JSON de texto):
 * <ul>
 *   <li>Primer mensaje obligatorio, en menos de 5 s: {@code {"type":"auth","token":"..."}}. El token no viaja
 *       en la URL para que no quede en los registros.</li>
 *   <li>{@code {"type":"signal","to":"<participantId>","data":{...}}}: se reenvía solo entre el anfitrión y un
 *       invitado aprobado.</li>
 *   <li>{@code {"type":"stats","data":{rttMs,fps,bitrateKbps,packetLossPct,jitterMs}}}</li>
 *   <li>{@code {"type":"ping"}} → {@code {"type":"pong"}}</li>
 * </ul>
 * El servidor envía: {@code auth-ok}, {@code session-updated}, {@code signal}, {@code evicted},
 * {@code session-closed}, {@code error} y {@code pong}.
 */
@Component
public class SignalingHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(SignalingHandler.class);

    public static final int MAX_SIGNAL_BYTES = 32 * 1024;
    public static final long AUTH_TIMEOUT_MS = 5_000;
    private static final int MAX_RATE_VIOLATIONS = 20;

    public static final CloseStatus UNAUTHORIZED = new CloseStatus(4401, "unauthorized");
    public static final CloseStatus EVICTED = new CloseStatus(4403, "evicted");
    public static final CloseStatus REPLACED = new CloseStatus(4409, "replaced");
    public static final CloseStatus SESSION_CLOSED = new CloseStatus(4410, "session-closed");
    public static final CloseStatus RATE_LIMITED = new CloseStatus(4429, "rate-limited");

    private static final class Conn {
        final WebSocketSession ws;
        final TokenBucket bucket;
        volatile AuthContext auth;
        int violations;

        Conn(WebSocketSession ws, TokenBucket bucket) {
            this.ws = ws;
            this.bucket = bucket;
        }

        String key() {
            return key(auth.sessionId(), auth.participantId());
        }

        static String key(String sessionId, String participantId) {
            return sessionId + ":" + participantId;
        }
    }

    private final SessionService sessions;
    private final ObjectMapper json;
    private final GameShareProperties.RateLimit limits;
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "ws-auth-timeout");
        t.setDaemon(true);
        return t;
    });
    private final ConcurrentHashMap<String, Conn> conns = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Conn> byParticipant = new ConcurrentHashMap<>();

    public SignalingHandler(SessionService sessions, ObjectMapper json, GameShareProperties props) {
        this.sessions = sessions;
        this.json = json;
        this.limits = props.rateLimit();
    }

    // ---------------------------------------------------------------- ciclo de vida

    @Override
    public void afterConnectionEstablished(WebSocketSession raw) {
        WebSocketSession ws = new ConcurrentWebSocketSessionDecorator(raw, 5_000, 256 * 1024);
        Conn c = new Conn(ws, new TokenBucket(limits.wsBurst(), limits.wsMessagesPerSecond(), System.nanoTime()));
        conns.put(raw.getId(), c);
        scheduler.schedule(() -> {
            if (c.auth == null && c.ws.isOpen()) {
                closeQuietly(c, UNAUTHORIZED);
            }
        }, AUTH_TIMEOUT_MS, TimeUnit.MILLISECONDS);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession raw, CloseStatus status) {
        Conn c = conns.remove(raw.getId());
        if (c != null && c.auth != null && byParticipant.remove(c.key(), c)) {
            sessions.setConnected(c.auth.sessionId(), c.auth.participantId(), false);
        }
    }

    @Override
    public void handleTransportError(WebSocketSession raw, Throwable exception) {
        log.debug("Error de transporte en WS {}: {}", raw.getId(), exception.toString());
    }

    @PreDestroy
    void shutdown() {
        scheduler.shutdownNow();
    }

    // ---------------------------------------------------------------- mensajes entrantes

    @Override
    protected void handleTextMessage(WebSocketSession raw, TextMessage message) {
        Conn c = conns.get(raw.getId());
        if (c == null) {
            return;
        }
        if (!c.bucket.tryConsume(System.nanoTime())) {
            if (++c.violations > MAX_RATE_VIOLATIONS) {
                log.warn("WS {} cerrado por exceso de mensajes", raw.getId());
                closeQuietly(c, RATE_LIMITED);
            } else {
                sendError(c, "RATE_LIMITED", "Demasiados mensajes.");
            }
            return;
        }

        JsonNode node;
        try {
            node = json.readTree(message.getPayload());
        } catch (JacksonException e) {
            sendError(c, "MALFORMED", "Mensaje JSON inválido.");
            return;
        }
        if (node == null || !node.isObject() || !node.path("type").isString()) {
            sendError(c, "MALFORMED", "Falta el campo 'type'.");
            return;
        }
        String type = node.get("type").asString();

        if (c.auth == null) {
            if ("auth".equals(type)) {
                handleAuth(c, node);
            } else {
                closeQuietly(c, UNAUTHORIZED);
            }
            return;
        }
        switch (type) {
            case "signal" -> handleSignal(c, node);
            case "stats" -> handleStats(c, node);
            case "ping" -> send(c, Map.of("type", "pong"));
            case "auth" -> sendError(c, "ALREADY_AUTHENTICATED", "La conexión ya está autenticada.");
            default -> sendError(c, "UNKNOWN_TYPE", "Tipo de mensaje desconocido.");
        }
    }

    private void handleAuth(Conn c, JsonNode node) {
        JsonNode token = node.path("token");
        AuthContext auth;
        try {
            if (!token.isString()) {
                throw ApiException.unauthorized();
            }
            auth = sessions.authenticate(token.asString());
        } catch (ApiException e) {
            sendError(c, "UNAUTHORIZED", "Token inválido o revocado.");
            closeQuietly(c, UNAUTHORIZED);
            return;
        }
        c.auth = auth;
        Conn previous = byParticipant.put(c.key(), c);
        if (previous != null && previous != c) {
            // Reconexión: la conexión nueva sustituye a la anterior.
            closeQuietly(previous, REPLACED);
        }
        Map<String, Object> ok = new LinkedHashMap<>();
        ok.put("type", "auth-ok");
        ok.put("participantId", auth.participantId());
        ok.put("role", auth.role());
        sessions.viewFor(auth.sessionId(), auth.participantId()).ifPresent(v -> ok.put("session", v));
        send(c, ok);
        sessions.setConnected(auth.sessionId(), auth.participantId(), true);
    }

    private void handleSignal(Conn c, JsonNode node) {
        JsonNode to = node.path("to");
        JsonNode data = node.get("data");
        if (!to.isString() || data == null || !data.isObject()) {
            sendError(c, "MALFORMED", "Un 'signal' necesita 'to' (texto) y 'data' (objeto).");
            return;
        }
        if (json.writeValueAsString(data).length() > MAX_SIGNAL_BYTES) {
            sendError(c, "TOO_LARGE", "El mensaje de señalización es demasiado grande.");
            return;
        }
        String from = c.auth.participantId();
        String target = to.asString();
        if (!sessions.canSignal(c.auth.sessionId(), from, target)) {
            sendError(c, "SIGNAL_FORBIDDEN", "No tienes permiso para señalizar a ese participante.");
            return;
        }
        Conn peer = byParticipant.get(Conn.key(c.auth.sessionId(), target));
        if (peer == null) {
            sendError(c, "PEER_OFFLINE", "El otro participante no está conectado.");
            return;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type", "signal");
        out.put("from", from);
        out.put("data", data);
        send(peer, out);
    }

    private void handleStats(Conn c, JsonNode node) {
        JsonNode d = node.get("data");
        if (d == null || !d.isObject()) {
            sendError(c, "MALFORMED", "'stats' necesita 'data'.");
            return;
        }
        Double rtt = num(d, "rttMs", 60_000);
        Double fps = num(d, "fps", 1_000);
        Double bitrate = num(d, "bitrateKbps", 1_000_000);
        Double loss = num(d, "packetLossPct", 100);
        Double jitter = num(d, "jitterMs", 60_000);
        if (rtt == null || fps == null || bitrate == null || loss == null || jitter == null) {
            sendError(c, "MALFORMED", "Valores de estadísticas fuera de rango.");
            return;
        }
        sessions.recordStats(c.auth.sessionId(), c.auth.participantId(),
                new ConnectionStats(rtt, fps, bitrate, loss, jitter, null));
    }

    /** Número finito en [0, max], o null si falta o no es válido. */
    private static Double num(JsonNode d, String field, double max) {
        JsonNode n = d.get(field);
        if (n == null || !n.isNumber()) {
            return null;
        }
        double v = n.asDouble();
        return Double.isFinite(v) && v >= 0 && v <= max ? v : null;
    }

    // ---------------------------------------------------------------- eventos de sesión

    @EventListener
    public void onChanged(SessionEvents.Changed e) {
        String prefix = e.sessionId() + ":";
        byParticipant.forEach((key, c) -> {
            if (key.startsWith(prefix)) {
                sessions.viewFor(e.sessionId(), c.auth.participantId()).ifPresent(view -> {
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("type", "session-updated");
                    out.put("reason", e.reason());
                    out.put("session", view);
                    send(c, out);
                });
            }
        });
    }

    @EventListener
    public void onEvicted(SessionEvents.ParticipantEvicted e) {
        Conn c = byParticipant.remove(Conn.key(e.sessionId(), e.participantId()));
        if (c != null) {
            send(c, Map.of("type", "evicted", "reason", e.reason()));
            closeQuietly(c, EVICTED);
        }
    }

    @EventListener
    public void onClosed(SessionEvents.Closed e) {
        for (String pid : e.participantIds()) {
            Conn c = byParticipant.remove(Conn.key(e.sessionId(), pid));
            if (c != null) {
                send(c, Map.of("type", "session-closed", "reason", e.reason()));
                closeQuietly(c, SESSION_CLOSED);
            }
        }
    }

    // ---------------------------------------------------------------- envío

    private void sendError(Conn c, String code, String message) {
        send(c, Map.of("type", "error", "code", code, "message", message));
    }

    private void send(Conn c, Object payload) {
        if (!c.ws.isOpen()) {
            return;
        }
        try {
            c.ws.sendMessage(new TextMessage(json.writeValueAsString(payload)));
        } catch (IOException | IllegalStateException e) {
            log.debug("No se pudo enviar a WS {}: {}", c.ws.getId(), e.toString());
        }
    }

    private static void closeQuietly(Conn c, CloseStatus status) {
        try {
            c.ws.close(status);
        } catch (IOException | IllegalStateException e) {
            log.debug("Error al cerrar WS {}: {}", c.ws.getId(), e.toString());
        }
    }
}
