package dev.gameshare.backend.session;

import java.time.Instant;

/** Estado mutable de un participante. Se accede siempre bajo el lock de su {@link Session}. */
final class Participant {

    final String id;
    final String displayName;
    final Role role;
    final String tokenHash;
    final Instant joinedAt;
    ParticipantStatus status;
    boolean gamepadAllowed;
    boolean connected;
    ConnectionStats stats;

    Participant(String id, String displayName, Role role, String tokenHash, ParticipantStatus status, Instant joinedAt) {
        this.id = id;
        this.displayName = displayName;
        this.role = role;
        this.tokenHash = tokenHash;
        this.status = status;
        this.joinedAt = joinedAt;
    }

    boolean isHost() {
        return role == Role.HOST;
    }
}
