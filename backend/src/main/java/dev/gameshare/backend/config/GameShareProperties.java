package dev.gameshare.backend.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "gameshare")
public record GameShareProperties(
        @NotNull List<String> allowedOrigins,
        /* Si se define, crear una sesión exige la cabecera X-Host-Key con este valor. */
        String hostKey,
        @NotNull Duration inviteTtl,
        @Min(1) int maxActiveInvites,
        @Min(1) int maxGuests,
        @NotNull Duration sessionIdleTtl,
        @Valid @NotNull Turn turn,
        @Valid @NotNull RateLimit rateLimit) {

    public record Turn(
            List<String> stunUrls,
            List<String> turnUrls,
            String secret,
            @NotNull Duration credentialTtl) {

        public List<String> stunUrls() {
            return clean(stunUrls);
        }

        public List<String> turnUrls() {
            return clean(turnUrls);
        }

        public boolean turnEnabled() {
            return secret != null && !secret.isBlank() && !turnUrls().isEmpty();
        }

        private static List<String> clean(List<String> urls) {
            return urls == null ? List.of() : urls.stream().map(String::trim).filter(s -> !s.isEmpty()).toList();
        }
    }

    public record RateLimit(
            @Min(1) int restPerMinute,
            @Min(1) int redeemPerMinute,
            @Min(1) int wsMessagesPerSecond,
            @Min(1) int wsBurst) {
    }
}
