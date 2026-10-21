package dev.gameshare.backend.session;

import java.util.List;

/** Eventos internos que la capa WebSocket reenvía a los clientes conectados. */
public final class SessionEvents {

    private SessionEvents() {
    }

    /** Cambió el estado visible de la sesión (por ejemplo, una solicitud de unión, una aprobación o un permiso). */
    public record Changed(String sessionId, String reason) {
    }

    /** Un participante perdió el acceso: debe cerrarse su WebSocket. */
    public record ParticipantEvicted(String sessionId, String participantId, String reason) {
    }

    /** La sesión terminó: deben cerrarse todos los WebSockets. */
    public record Closed(String sessionId, List<String> participantIds, String reason) {
    }
}
