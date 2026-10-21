package dev.gameshare.backend.api;

import static org.assertj.core.api.Assertions.assertThat;

import dev.gameshare.backend.support.ApiClient;
import dev.gameshare.backend.support.ApiClient.Response;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

/** Configuración estricta: clave de anfitrión y límite bajo de canjes. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "gameshare.host-key=my-host-key",
        "gameshare.rate-limit.redeem-per-minute=3"
})
class HardenedConfigTest {

    @LocalServerPort
    int port;

    @Test
    void hostKeyRequiredToCreateSessions() {
        ApiClient api = new ApiClient(port);
        Map<String, String> body = Map.of("displayName", "Host");
        Response missing = api.call("POST", "/api/sessions", null, body, Map.of());
        assertThat(missing.status()).isEqualTo(401);
        assertThat(missing.text("error")).isEqualTo("HOST_KEY_INVALID");

        Response wrong = api.call("POST", "/api/sessions", null, body, Map.of("X-Host-Key", "nope"));
        assertThat(wrong.status()).isEqualTo(401);

        Response ok = api.call("POST", "/api/sessions", null, body, Map.of("X-Host-Key", "my-host-key"));
        assertThat(ok.status()).isEqualTo(201);
    }

    @Test
    void redeemIsRateLimitedPerIp() {
        ApiClient api = new ApiClient(port);
        Map<String, String> body = Map.of("code", "AAAAAAAAAAAAAAAAAAAAAA", "displayName", "X");
        int limited = 0;
        for (int i = 0; i < 6; i++) {
            if (api.post("/api/invites/redeem", null, body).status() == 429) {
                limited++;
            }
        }
        assertThat(limited).isGreaterThanOrEqualTo(3);
    }
}
