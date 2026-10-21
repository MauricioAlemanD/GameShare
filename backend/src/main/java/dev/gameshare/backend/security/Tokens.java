package dev.gameshare.backend.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/** Generación de secretos aleatorios y hash para guardarlos sin conservar el valor original. */
public final class Tokens {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

    private Tokens() {
    }

    /** Secreto aleatorio en base64url. 16 bytes = 128 bits (22 caracteres); 32 bytes = 256 bits (43 caracteres). */
    public static String random(int bytes) {
        byte[] buf = new byte[bytes];
        RANDOM.nextBytes(buf);
        return B64.encodeToString(buf);
    }

    /** Identificador público corto (no secreto). */
    public static String id() {
        return random(9);
    }

    public static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
