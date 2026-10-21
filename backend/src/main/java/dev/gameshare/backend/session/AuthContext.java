package dev.gameshare.backend.session;

/** Identidad de quien hace la petición, resuelta a partir de su token. */
public record AuthContext(String sessionId, String participantId, Role role) {

    public boolean isHost() {
        return role == Role.HOST;
    }
}
