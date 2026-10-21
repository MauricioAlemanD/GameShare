package dev.gameshare.backend.session;

import java.time.Instant;
import java.util.List;

/** Vistas inmutables que se exponen por REST o WebSocket. Nunca incluyen tokens ni códigos. */
public final class Views {

    private Views() {
    }

    public record Credentials(String sessionId, String participantId, Role role, ParticipantStatus status, String token) {
    }

    public record ParticipantView(
            String id,
            String displayName,
            Role role,
            ParticipantStatus status,
            boolean gamepadAllowed,
            boolean connected,
            ConnectionStats stats) {
    }

    public record SessionView(
            String sessionId,
            Instant createdAt,
            String you,
            Role yourRole,
            ParticipantStatus yourStatus,
            List<ParticipantView> participants) {
    }

    /** El código solo se rellena en la respuesta de creación; después ya no se puede recuperar. */
    public record InviteView(String id, String code, Instant createdAt, Instant expiresAt, String state) {
    }

    public record IceServer(List<String> urls, String username, String credential) {
    }

    public record IceConfig(List<IceServer> iceServers, long ttlSeconds) {
    }
}
