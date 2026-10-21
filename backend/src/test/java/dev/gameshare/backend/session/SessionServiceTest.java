package dev.gameshare.backend.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.gameshare.backend.api.ApiException;
import dev.gameshare.backend.config.GameShareProperties;
import dev.gameshare.backend.session.Views.Credentials;
import dev.gameshare.backend.session.Views.InviteView;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class SessionServiceTest {

    /** Reloj manipulable para probar caducidades. */
    static final class MutableClock extends Clock {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }

        void advance(Duration d) {
            now = now.plus(d);
        }
    }

    private final MutableClock clock = new MutableClock();
    private final List<Object> events = new ArrayList<>();
    private SessionService service;

    @BeforeEach
    void setUp() {
        service = new SessionService(props(""), clock, events::add);
    }

    static GameShareProperties props(String hostKey) {
        return new GameShareProperties(
                List.of("http://localhost:4200"), hostKey, Duration.ofMinutes(15), 3, 1, Duration.ofHours(12),
                new GameShareProperties.Turn(List.of("stun:stun.example:3478"), List.of("turn:turn.example:3478"),
                        "turn-secret", Duration.ofHours(6)),
                new GameShareProperties.RateLimit(1000, 1000, 1000, 1000));
    }

    private record Setup(Credentials host, AuthContext hostAuth, Credentials guest, AuthContext guestAuth) {
    }

    private Setup hostWithPendingGuest() {
        Credentials host = service.createSession("Host");
        AuthContext hostAuth = service.authenticate(host.token());
        InviteView invite = service.createInvite(hostAuth, host.sessionId());
        Credentials guest = service.redeem(invite.code(), "Guest");
        return new Setup(host, hostAuth, guest, service.authenticate(guest.token()));
    }

    @Test
    void fullHappyPath() {
        Setup s = hostWithPendingGuest();
        assertThat(s.guest().status()).isEqualTo(ParticipantStatus.PENDING);
        assertThat(events).contains(new SessionEvents.Changed(s.host().sessionId(), "join-request"));

        // Un invitado pendiente no puede pedir servidores ICE ni señalizar.
        assertThatThrownBy(() -> service.iceConfig(s.guestAuth(), s.host().sessionId()))
                .isInstanceOf(ApiException.class).extracting("code").isEqualTo("FORBIDDEN");
        assertThat(service.canSignal(s.host().sessionId(), s.guest().participantId(), s.host().participantId())).isFalse();

        service.approve(s.hostAuth(), s.host().sessionId(), s.guest().participantId());
        assertThat(service.canSignal(s.host().sessionId(), s.guest().participantId(), s.host().participantId())).isTrue();
        assertThat(service.canSignal(s.host().sessionId(), s.host().participantId(), s.guest().participantId())).isTrue();

        Views.IceConfig ice = service.iceConfig(s.guestAuth(), s.host().sessionId());
        assertThat(ice.iceServers()).hasSize(2);
        assertThat(ice.iceServers().get(1).username()).endsWith(":" + s.guest().participantId());
    }

    @Test
    void inviteIsSingleUse() {
        Credentials host = service.createSession("Host");
        AuthContext hostAuth = service.authenticate(host.token());
        InviteView invite = service.createInvite(hostAuth, host.sessionId());
        service.redeem(invite.code(), "A");
        assertThatThrownBy(() -> service.redeem(invite.code(), "B"))
                .isInstanceOf(ApiException.class).extracting("code").isEqualTo("INVITE_USED");
    }

    @Test
    void inviteExpires() {
        Credentials host = service.createSession("Host");
        AuthContext hostAuth = service.authenticate(host.token());
        InviteView invite = service.createInvite(hostAuth, host.sessionId());
        clock.advance(Duration.ofMinutes(15));
        assertThatThrownBy(() -> service.redeem(invite.code(), "A"))
                .isInstanceOf(ApiException.class).extracting("code").isEqualTo("INVITE_EXPIRED");
    }

    @Test
    void revokedInviteCannotBeRedeemed() {
        Credentials host = service.createSession("Host");
        AuthContext hostAuth = service.authenticate(host.token());
        InviteView invite = service.createInvite(hostAuth, host.sessionId());
        service.revokeInvite(hostAuth, host.sessionId(), invite.id());
        assertThatThrownBy(() -> service.redeem(invite.code(), "A"))
                .isInstanceOf(ApiException.class).extracting("code").isEqualTo("INVITE_REVOKED");
    }

    @Test
    void unknownInviteIsRejected() {
        assertThatThrownBy(() -> service.redeem("AAAAAAAAAAAAAAAAAAAAAA", "A"))
                .isInstanceOf(ApiException.class).extracting("code").isEqualTo("INVITE_NOT_FOUND");
    }

    @Test
    void activeInviteLimitIsEnforced() {
        Credentials host = service.createSession("Host");
        AuthContext hostAuth = service.authenticate(host.token());
        for (int i = 0; i < 3; i++) {
            service.createInvite(hostAuth, host.sessionId());
        }
        assertThatThrownBy(() -> service.createInvite(hostAuth, host.sessionId()))
                .isInstanceOf(ApiException.class).extracting("code").isEqualTo("TOO_MANY_INVITES");
    }

    @Test
    void guestCannotPerformHostActions() {
        Setup s = hostWithPendingGuest();
        String sid = s.host().sessionId();
        assertThatThrownBy(() -> service.createInvite(s.guestAuth(), sid)).extracting("code").isEqualTo("FORBIDDEN");
        assertThatThrownBy(() -> service.approve(s.guestAuth(), sid, s.guest().participantId()))
                .extracting("code").isEqualTo("FORBIDDEN");
        assertThatThrownBy(() -> service.setGamepadPermission(s.guestAuth(), sid, s.guest().participantId(), true))
                .extracting("code").isEqualTo("FORBIDDEN");
        assertThatThrownBy(() -> service.closeSession(s.guestAuth(), sid)).extracting("code").isEqualTo("FORBIDDEN");
    }

    @Test
    void tokenFromAnotherSessionIsRejected() {
        Setup a = hostWithPendingGuest();
        Credentials other = service.createSession("Other");
        assertThatThrownBy(() -> service.view(a.hostAuth(), other.sessionId()))
                .extracting("code").isEqualTo("FORBIDDEN");
    }

    @Test
    void maxGuestsIsEnforced() {
        Setup s = hostWithPendingGuest();
        String sid = s.host().sessionId();
        service.approve(s.hostAuth(), sid, s.guest().participantId());
        InviteView second = service.createInvite(s.hostAuth(), sid);
        Credentials g2 = service.redeem(second.code(), "Second");
        assertThatThrownBy(() -> service.approve(s.hostAuth(), sid, g2.participantId()))
                .extracting("code").isEqualTo("SESSION_FULL");
    }

    @Test
    void revokeInvalidatesTokenAndPermissionsImmediately() {
        Setup s = hostWithPendingGuest();
        String sid = s.host().sessionId();
        String gid = s.guest().participantId();
        service.approve(s.hostAuth(), sid, gid);
        service.setGamepadPermission(s.hostAuth(), sid, gid, true);
        events.clear();

        service.removeParticipant(s.hostAuth(), sid, gid);

        assertThat(events).contains(new SessionEvents.ParticipantEvicted(sid, gid, "revoked"));
        assertThatThrownBy(() -> service.authenticate(s.guest().token())).extracting("code").isEqualTo("UNAUTHORIZED");
        assertThat(service.canSignal(sid, s.host().participantId(), gid)).isFalse();
        assertThat(service.view(s.hostAuth(), sid).participants()).hasSize(1);
    }

    @Test
    void rejectInvalidatesPendingGuest() {
        Setup s = hostWithPendingGuest();
        service.reject(s.hostAuth(), s.host().sessionId(), s.guest().participantId());
        assertThatThrownBy(() -> service.authenticate(s.guest().token())).extracting("code").isEqualTo("UNAUTHORIZED");
    }

    @Test
    void guestCanLeaveButHostCannot() {
        Setup s = hostWithPendingGuest();
        String sid = s.host().sessionId();
        assertThatThrownBy(() -> service.removeParticipant(s.hostAuth(), sid, s.host().participantId()))
                .extracting("code").isEqualTo("HOST_CANNOT_LEAVE");
        service.removeParticipant(s.guestAuth(), sid, s.guest().participantId());
        assertThat(events).contains(new SessionEvents.ParticipantEvicted(sid, s.guest().participantId(), "left"));
    }

    @Test
    void closeSessionInvalidatesEverything() {
        Setup s = hostWithPendingGuest();
        String sid = s.host().sessionId();
        InviteView pending = service.createInvite(s.hostAuth(), sid);
        service.closeSession(s.hostAuth(), sid);

        assertThat(events).anyMatch(e -> e instanceof SessionEvents.Closed c && c.sessionId().equals(sid));
        assertThatThrownBy(() -> service.authenticate(s.host().token())).extracting("code").isEqualTo("UNAUTHORIZED");
        assertThatThrownBy(() -> service.authenticate(s.guest().token())).extracting("code").isEqualTo("UNAUTHORIZED");
        assertThatThrownBy(() -> service.redeem(pending.code(), "Late")).extracting("code").isEqualTo("INVITE_NOT_FOUND");
    }

    @Test
    void pendingGuestOnlySeesHostAndSelf() {
        Setup s = hostWithPendingGuest();
        String sid = s.host().sessionId();
        InviteView second = service.createInvite(s.hostAuth(), sid);
        service.redeem(second.code(), "Other");
        assertThat(service.view(s.guestAuth(), sid).participants()).hasSize(2);
        assertThat(service.view(s.hostAuth(), sid).participants()).hasSize(3);
    }

    @Test
    void gamepadPermissionRequiresApprovedGuest() {
        Setup s = hostWithPendingGuest();
        assertThatThrownBy(() -> service.setGamepadPermission(s.hostAuth(), s.host().sessionId(),
                s.guest().participantId(), true)).extracting("code").isEqualTo("INVALID_STATE");
    }

    @Test
    void idleSessionsExpireOnlyWhenNobodyConnected() {
        Setup s = hostWithPendingGuest();
        String sid = s.host().sessionId();
        service.setConnected(sid, s.host().participantId(), true);
        clock.advance(Duration.ofHours(13));
        service.expireIdleSessions();
        assertThat(service.sessionCount()).isEqualTo(1);

        service.setConnected(sid, s.host().participantId(), false);
        clock.advance(Duration.ofHours(13));
        service.expireIdleSessions();
        assertThat(service.sessionCount()).isZero();
    }

    @Test
    void hostKeyIsCheckedWhenConfigured() {
        SessionService guarded = new SessionService(props("s3cret"), clock, events::add);
        guarded.checkHostKey("s3cret");
        assertThatThrownBy(() -> guarded.checkHostKey("wrong")).extracting("code").isEqualTo("HOST_KEY_INVALID");
        assertThatThrownBy(() -> guarded.checkHostKey(null)).extracting("code").isEqualTo("HOST_KEY_INVALID");
        service.checkHostKey(null); // sin clave configurada no se exige
    }
}
