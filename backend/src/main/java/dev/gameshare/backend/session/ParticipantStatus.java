package dev.gameshare.backend.session;

public enum ParticipantStatus {
    /** Ha canjeado la invitación y espera la aprobación del anfitrión. */
    PENDING,
    /** Aprobado: puede negociar WebRTC con el anfitrión. */
    APPROVED,
    REJECTED,
    REVOKED,
    LEFT;

    public boolean isActive() {
        return this == PENDING || this == APPROVED;
    }
}
