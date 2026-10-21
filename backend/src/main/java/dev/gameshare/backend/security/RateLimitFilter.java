package dev.gameshare.backend.security;

import dev.gameshare.backend.config.GameShareProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Limita peticiones REST por IP. El canje de invitaciones tiene un límite propio, más estricto. */
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RateLimitFilter.class);
    private static final long IDLE_EVICT_NANOS = Duration.ofMinutes(10).toNanos();

    private final GameShareProperties.RateLimit limits;
    private final ConcurrentHashMap<String, TokenBucket> general = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, TokenBucket> redeem = new ConcurrentHashMap<>();

    public RateLimitFilter(GameShareProperties props) {
        this.limits = props.rateLimit();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/") || "OPTIONS".equals(request.getMethod());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String ip = req.getRemoteAddr();
        long now = System.nanoTime();
        boolean ok = bucket(general, ip, limits.restPerMinute(), now).tryConsume(now);
        if (ok && req.getRequestURI().equals("/api/invites/redeem")) {
            ok = bucket(redeem, ip, limits.redeemPerMinute(), now).tryConsume(now);
        }
        if (!ok) {
            log.warn("Rate limit excedido para {} en {}", ip, req.getRequestURI());
            res.setStatus(429);
            res.setContentType("application/json");
            res.setHeader("Retry-After", "60");
            res.getWriter().write("{\"error\":\"RATE_LIMITED\",\"message\":\"Demasiadas peticiones. Espera un momento.\"}");
            return;
        }
        chain.doFilter(req, res);
    }

    private static TokenBucket bucket(ConcurrentHashMap<String, TokenBucket> map, String key, int perMinute, long now) {
        return map.computeIfAbsent(key, k -> new TokenBucket(perMinute, perMinute / 60d, now));
    }

    @Scheduled(fixedDelay = 60_000)
    void evictIdle() {
        long now = System.nanoTime();
        general.values().removeIf(b -> now - b.lastUsedNanos() > IDLE_EVICT_NANOS);
        redeem.values().removeIf(b -> now - b.lastUsedNanos() > IDLE_EVICT_NANOS);
    }
}
