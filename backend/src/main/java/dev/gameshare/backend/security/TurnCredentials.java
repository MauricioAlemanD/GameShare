package dev.gameshare.backend.security;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Credenciales TURN temporales compatibles con coturn {@code --use-auth-secret}
 * (draft-uberti-behave-turn-rest): usuario = "expiracionUnix:id" y contraseña = base64(HMAC-SHA1(secreto, usuario)).
 */
public final class TurnCredentials {

    private TurnCredentials() {
    }

    public record Credential(String username, String password) {
    }

    public static Credential create(String secret, long expiresAtEpochSeconds, String userId) {
        String username = expiresAtEpochSeconds + ":" + userId;
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA1"));
            byte[] sig = mac.doFinal(username.getBytes(StandardCharsets.UTF_8));
            return new Credential(username, Base64.getEncoder().encodeToString(sig));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
}
