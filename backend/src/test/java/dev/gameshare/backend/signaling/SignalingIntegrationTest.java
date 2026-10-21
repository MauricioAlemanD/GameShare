package dev.gameshare.backend.signaling;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.gameshare.backend.support.ApiClient;
import dev.gameshare.backend.support.ApiClient.Party;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.databind.JsonNode;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "gameshare.rate-limit.rest-per-minute=100000",
        "gameshare.rate-limit.redeem-per-minute=100000"
})
class SignalingIntegrationTest {

    @LocalServerPort
    int port;
    ApiClient api;

    @BeforeEach
    void setUp() {
        api = new ApiClient(port);
    }

    /** Cliente WS de prueba que encola los mensajes recibidos y el cierre. */
    final class Peer extends TextWebSocketHandler {
        final BlockingQueue<JsonNode> inbox = new LinkedBlockingQueue<>();
        final CompletableFuture<CloseStatus> closed = new CompletableFuture<>();
        WebSocketSession ws;

        Peer connect(String origin) throws Exception {
            WebSocketHttpHeaders headers = new WebSocketHttpHeaders();
            if (origin != null) {
                headers.setOrigin(origin);
            }
            ws = new StandardWebSocketClient()
                    .execute(this, headers, URI.create("ws://localhost:" + port + "/ws"))
                    .get(5, TimeUnit.SECONDS);
            return this;
        }

        Peer connect() throws Exception {
            return connect("app://gameshare");
        }

        void send(Object msg) throws Exception {
            ws.sendMessage(new TextMessage(ApiClient.JSON.writeValueAsString(msg)));
        }

        Peer auth(String token) throws Exception {
            send(Map.of("type", "auth", "token", token));
            JsonNode ok = await("auth-ok");
            assertThat(ok.path("session").isObject()).isTrue();
            return this;
        }

        /** Espera un mensaje del tipo indicado, descartando los demás. */
        JsonNode await(String type) throws InterruptedException {
            long deadline = System.currentTimeMillis() + 5_000;
            while (System.currentTimeMillis() < deadline) {
                JsonNode m = inbox.poll(100, TimeUnit.MILLISECONDS);
                if (m != null && type.equals(m.path("type").asString())) {
                    return m;
                }
            }
            throw new AssertionError("No llegó un mensaje '" + type + "'");
        }

        JsonNode awaitUpdate(String reason) throws InterruptedException {
            long deadline = System.currentTimeMillis() + 5_000;
            while (System.currentTimeMillis() < deadline) {
                JsonNode m = inbox.poll(100, TimeUnit.MILLISECONDS);
                if (m != null && "session-updated".equals(m.path("type").asString())
                        && reason.equals(m.path("reason").asString())) {
                    return m;
                }
            }
            throw new AssertionError("No llegó session-updated con reason=" + reason);
        }

        int closeCode() throws Exception {
            return closed.get(7, TimeUnit.SECONDS).getCode();
        }

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) {
            inbox.add(ApiClient.JSON.readTree(message.getPayload()));
        }

        @Override
        public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
            closed.complete(status);
        }
    }

    @Test
    void fullSignalingFlowWithApprovalAndRevocation() throws Exception {
        Party host = api.createSession("Host");
        Peer hostWs = new Peer().connect().auth(host.token());

        Party guest = api.redeem(api.createInvite(host), "Guest");
        hostWs.awaitUpdate("join-request");

        Peer guestWs = new Peer().connect().auth(guest.token());
        hostWs.awaitUpdate("peer-online");

        // Pendiente: todavía no puede señalizar.
        guestWs.send(Map.of("type", "signal", "to", host.participantId(), "data", Map.of("kind", "offer")));
        assertThat(guestWs.await("error").path("code").asString()).isEqualTo("SIGNAL_FORBIDDEN");

        assertThat(api.approve(host, guest).status()).isEqualTo(200);
        JsonNode approved = guestWs.awaitUpdate("approved");
        assertThat(approved.path("session").path("yourStatus").asString()).isEqualTo("APPROVED");

        // El anfitrión envía la oferta y el invitado responde.
        hostWs.send(Map.of("type", "signal", "to", guest.participantId(),
                "data", Map.of("kind", "offer", "sdp", "v=0...")));
        JsonNode offer = guestWs.await("signal");
        assertThat(offer.path("from").asString()).isEqualTo(host.participantId());
        assertThat(offer.path("data").path("sdp").asString()).isEqualTo("v=0...");

        guestWs.send(Map.of("type", "signal", "to", host.participantId(), "data", Map.of("kind", "answer")));
        assertThat(hostWs.await("signal").path("data").path("kind").asString()).isEqualTo("answer");

        // Estadísticas: se guarda la última y se difunde.
        guestWs.send(Map.of("type", "stats", "data",
                Map.of("rttMs", 42, "fps", 60, "bitrateKbps", 8000, "packetLossPct", 0.5, "jitterMs", 3)));
        JsonNode stats = hostWs.awaitUpdate("stats");
        assertThat(stats.toString()).contains("\"rttMs\":42");

        // Revocación: el invitado es expulsado de inmediato.
        api.delete("/api/sessions/" + host.sessionId() + "/participants/" + guest.participantId(), host.token());
        assertThat(guestWs.await("evicted").path("reason").asString()).isEqualTo("revoked");
        assertThat(guestWs.closeCode()).isEqualTo(4403);
        hostWs.awaitUpdate("revoked");

        // Y ya no puede volver a conectarse con su token.
        Peer again = new Peer().connect();
        again.send(Map.of("type", "auth", "token", guest.token()));
        assertThat(again.await("error").path("code").asString()).isEqualTo("UNAUTHORIZED");
        assertThat(again.closeCode()).isEqualTo(4401);
    }

    @Test
    void messagesBeforeAuthCloseTheConnection() throws Exception {
        Peer p = new Peer().connect();
        p.send(Map.of("type", "signal", "to", "x", "data", Map.of()));
        assertThat(p.closeCode()).isEqualTo(4401);
    }

    @Test
    void connectionWithoutAuthTimesOut() throws Exception {
        Peer p = new Peer().connect();
        assertThat(p.closeCode()).isEqualTo(4401);
    }

    @Test
    void malformedMessagesAreRejectedWithoutClosing() throws Exception {
        Party host = api.createSession("Host");
        Peer p = new Peer().connect().auth(host.token());
        p.ws.sendMessage(new TextMessage("{not json"));
        assertThat(p.await("error").path("code").asString()).isEqualTo("MALFORMED");
        p.send(Map.of("type", "stats", "data", Map.of("rttMs", -5)));
        assertThat(p.await("error").path("code").asString()).isEqualTo("MALFORMED");
        p.send(Map.of("type", "whatever"));
        assertThat(p.await("error").path("code").asString()).isEqualTo("UNKNOWN_TYPE");
        p.send(Map.of("type", "ping"));
        p.await("pong");
        assertThat(p.ws.isOpen()).isTrue();
    }

    @Test
    void cannotSignalToParticipantOfAnotherSession() throws Exception {
        Party hostA = api.createSession("A");
        Party hostB = api.createSession("B");
        Party guestB = api.redeem(api.createInvite(hostB), "GB");
        api.approve(hostB, guestB);
        Peer a = new Peer().connect().auth(hostA.token());
        new Peer().connect().auth(guestB.token());
        a.send(Map.of("type", "signal", "to", guestB.participantId(), "data", Map.of("kind", "offer")));
        assertThat(a.await("error").path("code").asString()).isEqualTo("SIGNAL_FORBIDDEN");
    }

    @Test
    void closingSessionNotifiesAndDisconnectsGuests() throws Exception {
        Party host = api.createSession("Host");
        Party guest = api.redeem(api.createInvite(host), "Guest");
        Peer guestWs = new Peer().connect().auth(guest.token());
        api.delete("/api/sessions/" + host.sessionId(), host.token());
        assertThat(guestWs.await("session-closed").path("reason").asString()).isEqualTo("closed-by-host");
        assertThat(guestWs.closeCode()).isEqualTo(4410);
    }

    @Test
    void reconnectionReplacesPreviousConnection() throws Exception {
        Party host = api.createSession("Host");
        Peer first = new Peer().connect().auth(host.token());
        new Peer().connect().auth(host.token());
        assertThat(first.closeCode()).isEqualTo(4409);
    }

    @Test
    void guestDisconnectIsReportedToHost() throws Exception {
        Party host = api.createSession("Host");
        Party guest = api.redeem(api.createInvite(host), "Guest");
        api.approve(host, guest);
        Peer hostWs = new Peer().connect().auth(host.token());
        Peer guestWs = new Peer().connect().auth(guest.token());
        hostWs.awaitUpdate("peer-online");
        guestWs.ws.close();
        JsonNode offline = hostWs.awaitUpdate("peer-offline");
        assertThat(offline.toString()).contains("\"connected\":false");
    }

    @Test
    void foreignOriginIsRejectedAtHandshake() {
        assertThatThrownBy(() -> new Peer().connect("https://evil.example")).isNotNull();
    }
}
