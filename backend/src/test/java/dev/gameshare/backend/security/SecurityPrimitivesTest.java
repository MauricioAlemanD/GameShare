package dev.gameshare.backend.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

class SecurityPrimitivesTest {

    @Test
    void randomTokensHaveExpectedLengthAndAreUnique() {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < 1000; i++) {
            String code = Tokens.random(16);
            assertThat(code).hasSize(22).matches("[A-Za-z0-9_-]+");
            assertThat(seen.add(code)).isTrue();
        }
        assertThat(Tokens.random(32)).hasSize(43);
    }

    @Test
    void sha256IsDeterministicHex() {
        assertThat(Tokens.sha256("abc"))
                .isEqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    @Test
    void tokenBucketLimitsBurstAndRefills() {
        long t = 0;
        TokenBucket bucket = new TokenBucket(3, 1, t); // 3 de ráfaga, 1/s
        assertThat(bucket.tryConsume(t)).isTrue();
        assertThat(bucket.tryConsume(t)).isTrue();
        assertThat(bucket.tryConsume(t)).isTrue();
        assertThat(bucket.tryConsume(t)).isFalse();
        t += 1_000_000_000L; // +1 s
        assertThat(bucket.tryConsume(t)).isTrue();
        assertThat(bucket.tryConsume(t)).isFalse();
    }

    @Test
    void turnCredentialsMatchCoturnRestScheme() {
        // Vector calculado de forma independiente con Python (hmac + sha1 + base64).
        TurnCredentials.Credential c = TurnCredentials.create("test-secret", 1_700_000_000L, "participant1");
        assertThat(c.username()).isEqualTo("1700000000:participant1");
        assertThat(c.password()).isEqualTo("WJGytmdqI3z/AK6vcucyCHl1wAA=");
    }
}
