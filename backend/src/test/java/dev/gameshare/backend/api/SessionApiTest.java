package dev.gameshare.backend.api;

import static org.assertj.core.api.Assertions.assertThat;

import dev.gameshare.backend.support.ApiClient;
import dev.gameshare.backend.support.ApiClient.Party;
import dev.gameshare.backend.support.ApiClient.Response;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "gameshare.rate-limit.rest-per-minute=100000",
        "gameshare.rate-limit.redeem-per-minute=100000",
        "gameshare.turn.turn-urls=turn:turn.example:3478",
        "gameshare.turn.secret=test-secret"
})
class SessionApiTest {

    @LocalServerPort
    int port;
    ApiClient api;

    @BeforeEach
    void setUp() {
        api = new ApiClient(port);
    }

    @Test
    void completeFlowOverRest() {
        Party host = api.createSession("Mau");
        String code = api.createInvite(host);
        assertThat(code).hasSize(22);

        Party guest = api.redeem(code, "Novia");
        assertThat(guest.sessionId()).isEqualTo(host.sessionId());

        Response view = api.get("/api/sessions/" + host.sessionId(), host.token());
        assertThat(view.status()).isEqualTo(200);
        assertThat(view.body().path("participants")).hasSize(2);
        assertThat(view.body().toString()).doesNotContain(host.token()).doesNotContain(guest.token());

        assertThat(api.approve(host, guest).status()).isEqualTo(200);

        Response perm = api.put("/api/sessions/" + host.sessionId() + "/participants/" + guest.participantId()
                + "/permissions", host.token(), Map.of("gamepad", true));
        assertThat(perm.status()).isEqualTo(200);

        Response ice = api.get("/api/sessions/" + host.sessionId() + "/ice-servers", guest.token());
        assertThat(ice.status()).isEqualTo(200);
        assertThat(ice.body().path("iceServers")).hasSize(2);

        Response revoke = api.delete("/api/sessions/" + host.sessionId() + "/participants/" + guest.participantId(),
                host.token());
        assertThat(revoke.status()).isEqualTo(204);
        assertThat(api.get("/api/sessions/" + host.sessionId(), guest.token()).status()).isEqualTo(401);
    }

    @Test
    void invitesAreNeverListedWithCode() {
        Party host = api.createSession("Host");
        api.createInvite(host);
        Response list = api.get("/api/sessions/" + host.sessionId() + "/invites", host.token());
        assertThat(list.status()).isEqualTo(200);
        assertThat(list.body().get(0).path("code").isNull()).isTrue();
        assertThat(list.body().get(0).path("state").asString()).isEqualTo("ACTIVE");
    }

    @Test
    void reusedInviteGivesGoneWithReadableCode() {
        Party host = api.createSession("Host");
        String code = api.createInvite(host);
        api.redeem(code, "One");
        Response second = api.post("/api/invites/redeem", null, Map.of("code", code, "displayName", "Two"));
        assertThat(second.status()).isEqualTo(410);
        assertThat(second.text("error")).isEqualTo("INVITE_USED");
        assertThat(second.text("message")).isNotBlank();
    }

    @Test
    void authErrors() {
        Party host = api.createSession("Host");
        String path = "/api/sessions/" + host.sessionId();
        assertThat(api.get(path, null).status()).isEqualTo(401);
        assertThat(api.get(path, "not-a-real-token").status()).isEqualTo(401);
        assertThat(api.get(path, null).text("error")).isEqualTo("UNAUTHORIZED");

        Party other = api.createSession("Other");
        assertThat(api.get(path, other.token()).status()).isEqualTo(403);
    }

    @Test
    void guestCannotUseHostEndpoints() {
        Party host = api.createSession("Host");
        Party guest = api.redeem(api.createInvite(host), "Guest");
        assertThat(api.post("/api/sessions/" + host.sessionId() + "/invites", guest.token(), null).status())
                .isEqualTo(403);
        assertThat(api.approve(new Party(host.sessionId(), host.participantId(), guest.token()), guest).status())
                .isEqualTo(403);
        assertThat(api.delete("/api/sessions/" + host.sessionId(), guest.token()).status()).isEqualTo(403);
        // Pendiente: aún no recibe servidores ICE.
        assertThat(api.get("/api/sessions/" + host.sessionId() + "/ice-servers", guest.token()).status())
                .isEqualTo(403);
    }

    @Test
    void validationErrors() {
        Response badName = api.post("/api/sessions", null, Map.of("displayName", "<script>"));
        assertThat(badName.status()).isEqualTo(400);
        assertThat(badName.text("error")).isEqualTo("VALIDATION_ERROR");

        Response emptyName = api.post("/api/sessions", null, Map.of("displayName", ""));
        assertThat(emptyName.status()).isEqualTo(400);

        Response malformed = api.post("/api/sessions", null, "{not json");
        assertThat(malformed.status()).isEqualTo(400);
        assertThat(malformed.text("error")).isEqualTo("MALFORMED_REQUEST");

        Response badCode = api.post("/api/invites/redeem", null, Map.of("code", "short", "displayName", "X"));
        assertThat(badCode.status()).isEqualTo(400);

        Response unknown = api.post("/api/invites/redeem", null,
                Map.of("code", "AAAAAAAAAAAAAAAAAAAAAA", "displayName", "X"));
        assertThat(unknown.status()).isEqualTo(404);
        assertThat(unknown.text("error")).isEqualTo("INVITE_NOT_FOUND");
    }

    @Test
    void closeSessionKicksEveryone() {
        Party host = api.createSession("Host");
        Party guest = api.redeem(api.createInvite(host), "Guest");
        assertThat(api.delete("/api/sessions/" + host.sessionId(), host.token()).status()).isEqualTo(204);
        assertThat(api.get("/api/sessions/" + host.sessionId(), host.token()).status()).isEqualTo(401);
        assertThat(api.get("/api/sessions/" + host.sessionId(), guest.token()).status()).isEqualTo(401);
    }

    @Test
    void corsAllowsOnlyConfiguredOrigins() {
        Map<String, String> allowed = Map.of("Origin", "app://gameshare", "Access-Control-Request-Method", "POST");
        Response ok = api.call("OPTIONS", "/api/sessions", null, null, allowed);
        assertThat(ok.status()).isEqualTo(200);
        assertThat(ok.raw().headers().firstValue("Access-Control-Allow-Origin")).hasValue("app://gameshare");

        Map<String, String> evil = Map.of("Origin", "https://evil.example", "Access-Control-Request-Method", "POST");
        assertThat(api.call("OPTIONS", "/api/sessions", null, null, evil).status()).isEqualTo(403);
    }

    @Test
    void healthIsUpAndUnknownRoutesReturnJson404() {
        assertThat(api.get("/actuator/health", null).text("status")).isEqualTo("UP");
        Response missing = api.get("/api/nope", null);
        assertThat(missing.status()).isEqualTo(404);
        assertThat(missing.text("error")).isEqualTo("NOT_FOUND");
    }
}
