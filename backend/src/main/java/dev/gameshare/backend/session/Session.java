package dev.gameshare.backend.session;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** Sesión en memoria. Toda mutación se hace dentro de {@code synchronized (session)}. */
final class Session {

    final String id;
    final Instant createdAt;
    final Map<String, Participant> participants = new LinkedHashMap<>();
    final Map<String, Invite> invites = new LinkedHashMap<>();
    Instant lastActivity;
    boolean closed;

    Session(String id, Instant createdAt) {
        this.id = id;
        this.createdAt = createdAt;
        this.lastActivity = createdAt;
    }

    Participant host() {
        return participants.values().stream().filter(Participant::isHost).findFirst().orElseThrow();
    }

    long approvedGuests() {
        return participants.values().stream()
                .filter(p -> p.role == Role.GUEST && p.status == ParticipantStatus.APPROVED)
                .count();
    }
}
