package dev.gameshare.backend.session;

import java.time.Instant;

/**
 * Última instantánea de calidad de conexión que informa un cliente. Solo se guarda la última, sin histórico.
 * Los rangos se validan en {@code SignalingHandler} antes de crearla.
 */
public record ConnectionStats(
        double rttMs,
        double fps,
        double bitrateKbps,
        double packetLossPct,
        double jitterMs,
        Instant reportedAt) {
}
