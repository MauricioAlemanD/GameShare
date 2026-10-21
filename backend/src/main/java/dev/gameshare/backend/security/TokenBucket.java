package dev.gameshare.backend.security;

/** Token bucket clásico. Thread-safe. */
public final class TokenBucket {

    private final double capacity;
    private final double refillPerNano;
    private double tokens;
    private long last;

    public TokenBucket(double capacity, double refillPerSecond, long nowNanos) {
        this.capacity = capacity;
        this.refillPerNano = refillPerSecond / 1_000_000_000d;
        this.tokens = capacity;
        this.last = nowNanos;
    }

    public synchronized boolean tryConsume(long nowNanos) {
        long elapsed = Math.max(0, nowNanos - last);
        last = nowNanos;
        tokens = Math.min(capacity, tokens + elapsed * refillPerNano);
        if (tokens >= 1) {
            tokens -= 1;
            return true;
        }
        return false;
    }

    public synchronized long lastUsedNanos() {
        return last;
    }
}
