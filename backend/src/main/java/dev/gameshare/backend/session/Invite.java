package dev.gameshare.backend.session;

import java.time.Instant;

/** Invitación de un solo uso. Solo se guarda el hash del código. */
final class Invite {

    enum State { ACTIVE, USED, REVOKED, EXPIRED }

    final String id;
    final String codeHash;
    final Instant createdAt;
    final Instant expiresAt;
    String usedBy;
    boolean revoked;

    Invite(String id, String codeHash, Instant createdAt, Instant expiresAt) {
        this.id = id;
        this.codeHash = codeHash;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    State state(Instant now) {
        if (revoked) {
            return State.REVOKED;
        }
        if (usedBy != null) {
            return State.USED;
        }
        if (!now.isBefore(expiresAt)) {
            return State.EXPIRED;
        }
        return State.ACTIVE;
    }
}
