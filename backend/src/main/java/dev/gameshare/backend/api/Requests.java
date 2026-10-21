package dev.gameshare.backend.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** Cuerpos de petición validados. */
public final class Requests {

    /** Letras, números, espacio y . _ - (1–32 caracteres). */
    static final String NAME_REGEX = "^[\\p{L}\\p{N} ._-]{1,32}$";
    /** Código de invitación base64url de 128 bits (22 caracteres). */
    static final String CODE_REGEX = "^[A-Za-z0-9_-]{22}$";

    private Requests() {
    }

    public record CreateSession(
            @NotBlank @Pattern(regexp = NAME_REGEX, message = "nombre inválido (1-32 letras, números, espacio . _ -)")
            String displayName) {
    }

    public record RedeemInvite(
            @NotBlank @Pattern(regexp = CODE_REGEX, message = "formato de invitación inválido")
            String code,
            @NotBlank @Pattern(regexp = NAME_REGEX, message = "nombre inválido (1-32 letras, números, espacio . _ -)")
            String displayName) {
    }

    public record Permissions(@NotNull Boolean gamepad) {
    }
}
