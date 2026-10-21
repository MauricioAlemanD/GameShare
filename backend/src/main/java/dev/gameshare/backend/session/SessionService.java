package dev.gameshare.backend.session;

import dev.gameshare.backend.api.ApiException;
import dev.gameshare.backend.config.GameShareProperties;
import dev.gameshare.backend.security.Tokens;
import dev.gameshare.backend.security.TurnCredentials;
import dev.gameshare.backend.session.Views.Credentials;
import dev.gameshare.backend.session.Views.IceConfig;
import dev.gameshare.backend.session.Views.IceServer;
import dev.gameshare.backend.session.Views.InviteView;
import dev.gameshare.backend.session.Views.ParticipantView;
import dev.gameshare.backend.session.Views.SessionView;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Reglas de negocio de sesiones, invitaciones y permisos. Estado solo en memoria.
 *
 * <p>Los tokens y los códigos de invitación se guardan únicamente como hash SHA-256.
 * Los eventos se publican fuera del lock de la sesión.
 */
@Service
public class SessionService {

    private static final Logger log = LoggerFactory.getLogger(SessionService.class);
    static final int MAX_SESSIONS = 1000;
    static final int MAX_INVITES_PER_SESSION = 50;

    private record TokenRef(String sessionId, String participantId) {
    }

    private record InviteRef(String sessionId, String inviteId) {
    }

    private final ConcurrentHashMap<String, Session> sessions = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, TokenRef> tokens = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, InviteRef> inviteCodes = new ConcurrentHashMap<>();

    private final GameShareProperties props;
    private final Clock clock;
    private final ApplicationEventPublisher events;

    public SessionService(GameShareProperties props, Clock clock, ApplicationEventPublisher events) {
        this.props = props;
        this.clock = clock;
        this.events = events;
    }

    // ---------------------------------------------------------------- creación y autenticación

    /** Comprueba la clave de anfitrión, si está configurada (limita quién puede crear salas en tu servidor). */
    public void checkHostKey(String provided) {
        String expected = props.hostKey();
        if (expected == null || expected.isBlank()) {
            return;
        }
        byte[] a = expected.getBytes(StandardCharsets.UTF_8);
        byte[] b = provided == null ? new byte[0] : provided.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(a, b)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "HOST_KEY_INVALID", "Clave de anfitrión incorrecta.");
        }
    }

    public Credentials createSession(String hostName) {
        if (sessions.size() >= MAX_SESSIONS) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "SERVER_FULL", "El servidor no admite más sesiones.");
        }
        Instant now = clock.instant();
        Session session = new Session(Tokens.id(), now);
        String token = Tokens.random(32);
        Participant host = new Participant(Tokens.id(), hostName, Role.HOST, Tokens.sha256(token),
                ParticipantStatus.APPROVED, now);
        session.participants.put(host.id, host);
        sessions.put(session.id, session);
        tokens.put(host.tokenHash, new TokenRef(session.id, host.id));
        log.info("Sesión {} creada", session.id);
        return new Credentials(session.id, host.id, Role.HOST, host.status, token);
    }

    public AuthContext authenticate(String token) {
        if (token == null || token.isBlank() || token.length() > 128) {
            throw ApiException.unauthorized();
        }
        TokenRef ref = tokens.get(Tokens.sha256(token));
        Session session = ref == null ? null : sessions.get(ref.sessionId());
        if (session == null) {
            throw ApiException.unauthorized();
        }
        synchronized (session) {
            Participant p = session.participants.get(ref.participantId());
            if (session.closed || p == null || !p.status.isActive()) {
                throw ApiException.unauthorized();
            }
            session.lastActivity = clock.instant();
            return new AuthContext(session.id, p.id, p.role);
        }
    }

    // ---------------------------------------------------------------- consulta

    public SessionView view(AuthContext auth, String sessionId) {
        Session s = sessionFor(auth, sessionId);
        synchronized (s) {
            return viewFor(s, requireActive(s, auth));
        }
    }

    /** Vista para el WebSocket; vacía si el participante ya no está activo. */
    public Optional<SessionView> viewFor(String sessionId, String participantId) {
        Session s = sessions.get(sessionId);
        if (s == null) {
            return Optional.empty();
        }
        synchronized (s) {
            Participant p = s.participants.get(participantId);
            if (s.closed || p == null || !p.status.isActive()) {
                return Optional.empty();
            }
            return Optional.of(viewFor(s, p));
        }
    }

    private static SessionView viewFor(Session s, Participant viewer) {
        boolean pendingGuest = viewer.role == Role.GUEST && viewer.status == ParticipantStatus.PENDING;
        List<ParticipantView> list = s.participants.values().stream()
                .filter(p -> p.status.isActive())
                // Un invitado pendiente solo ve al anfitrión y a sí mismo.
                .filter(p -> !pendingGuest || p.isHost() || p == viewer)
                .map(p -> new ParticipantView(p.id, p.displayName, p.role, p.status, p.gamepadAllowed, p.connected, p.stats))
                .toList();
        return new SessionView(s.id, s.createdAt, viewer.id, viewer.role, viewer.status, list);
    }

    // ---------------------------------------------------------------- invitaciones

    public InviteView createInvite(AuthContext auth, String sessionId) {
        Session s = sessionFor(auth, sessionId);
        requireHost(auth);
        synchronized (s) {
            requireActive(s, auth);
            Instant now = clock.instant();
            long active = s.invites.values().stream().filter(i -> i.state(now) == Invite.State.ACTIVE).count();
            if (active >= props.maxActiveInvites()) {
                throw ApiException.conflict("TOO_MANY_INVITES",
                        "Ya hay " + active + " invitaciones activas. Revoca alguna antes de crear otra.");
            }
            if (s.invites.size() >= MAX_INVITES_PER_SESSION) {
                throw ApiException.conflict("TOO_MANY_INVITES", "Se alcanzó el máximo de invitaciones de esta sesión.");
            }
            String code = Tokens.random(16); // 128 bits
            Invite invite = new Invite(Tokens.id(), Tokens.sha256(code), now, now.plus(props.inviteTtl()));
            s.invites.put(invite.id, invite);
            inviteCodes.put(invite.codeHash, new InviteRef(s.id, invite.id));
            log.info("Sesión {}: invitación {} creada (expira {})", s.id, invite.id, invite.expiresAt);
            return new InviteView(invite.id, code, invite.createdAt, invite.expiresAt, invite.state(now).name());
        }
    }

    public List<InviteView> listInvites(AuthContext auth, String sessionId) {
        Session s = sessionFor(auth, sessionId);
        requireHost(auth);
        synchronized (s) {
            Instant now = clock.instant();
            return s.invites.values().stream()
                    .map(i -> new InviteView(i.id, null, i.createdAt, i.expiresAt, i.state(now).name()))
                    .toList();
        }
    }

    public InviteView revokeInvite(AuthContext auth, String sessionId, String inviteId) {
        Session s = sessionFor(auth, sessionId);
        requireHost(auth);
        synchronized (s) {
            Invite i = s.invites.get(inviteId);
            if (i == null) {
                throw ApiException.notFound("INVITE_NOT_FOUND", "La invitación no existe.");
            }
            i.revoked = true;
            log.info("Sesión {}: invitación {} revocada", s.id, i.id);
            return new InviteView(i.id, null, i.createdAt, i.expiresAt, i.state(clock.instant()).name());
        }
    }

    public Credentials redeem(String code, String displayName) {
        InviteRef ref = inviteCodes.get(Tokens.sha256(code));
        if (ref == null) {
            throw ApiException.notFound("INVITE_NOT_FOUND", "La invitación no es válida.");
        }
        Session s = sessions.get(ref.sessionId());
        if (s == null) {
            throw ApiException.gone("SESSION_ENDED", "La sesión de esta invitación ya terminó.");
        }
        Credentials credentials;
        synchronized (s) {
            if (s.closed) {
                throw ApiException.gone("SESSION_ENDED", "La sesión de esta invitación ya terminó.");
            }
            Invite invite = s.invites.get(ref.inviteId());
            Instant now = clock.instant();
            switch (invite.state(now)) {
                case USED -> throw ApiException.gone("INVITE_USED", "Esta invitación ya se usó.");
                case REVOKED -> throw ApiException.gone("INVITE_REVOKED", "El anfitrión revocó esta invitación.");
                case EXPIRED -> throw ApiException.gone("INVITE_EXPIRED", "La invitación caducó. Pide una nueva.");
                case ACTIVE -> { }
            }
            String token = Tokens.random(32);
            Participant guest = new Participant(Tokens.id(), displayName, Role.GUEST, Tokens.sha256(token),
                    ParticipantStatus.PENDING, now);
            s.participants.put(guest.id, guest);
            invite.usedBy = guest.id;
            tokens.put(guest.tokenHash, new TokenRef(s.id, guest.id));
            s.lastActivity = now;
            log.info("Sesión {}: invitación {} canjeada por participante {} (pendiente)", s.id, invite.id, guest.id);
            credentials = new Credentials(s.id, guest.id, Role.GUEST, guest.status, token);
        }
        events.publishEvent(new SessionEvents.Changed(s.id, "join-request"));
        return credentials;
    }

    // ---------------------------------------------------------------- participantes

    public SessionView approve(AuthContext auth, String sessionId, String participantId) {
        Session s = sessionFor(auth, sessionId);
        requireHost(auth);
        SessionView view;
        synchronized (s) {
            Participant host = requireActive(s, auth);
            Participant p = requireGuest(s, participantId);
            if (p.status != ParticipantStatus.PENDING) {
                throw ApiException.conflict("INVALID_STATE", "El participante no está pendiente de aprobación.");
            }
            if (s.approvedGuests() >= props.maxGuests()) {
                throw ApiException.conflict("SESSION_FULL", "La sesión ya tiene el máximo de invitados.");
            }
            p.status = ParticipantStatus.APPROVED;
            log.info("Sesión {}: participante {} aprobado", s.id, p.id);
            view = viewFor(s, host);
        }
        events.publishEvent(new SessionEvents.Changed(s.id, "approved"));
        return view;
    }

    public SessionView reject(AuthContext auth, String sessionId, String participantId) {
        Session s = sessionFor(auth, sessionId);
        requireHost(auth);
        SessionView view;
        synchronized (s) {
            Participant host = requireActive(s, auth);
            Participant p = requireGuest(s, participantId);
            if (p.status != ParticipantStatus.PENDING) {
                throw ApiException.conflict("INVALID_STATE", "El participante no está pendiente de aprobación.");
            }
            deactivate(p, ParticipantStatus.REJECTED);
            log.info("Sesión {}: participante {} rechazado", s.id, p.id);
            view = viewFor(s, host);
        }
        events.publishEvent(new SessionEvents.ParticipantEvicted(s.id, participantId, "rejected"));
        events.publishEvent(new SessionEvents.Changed(s.id, "rejected"));
        return view;
    }

    /** El anfitrión revoca a un invitado, o un invitado se marcha él mismo. */
    public void removeParticipant(AuthContext auth, String sessionId, String participantId) {
        Session s = sessionFor(auth, sessionId);
        boolean self = auth.participantId().equals(participantId);
        if (self && auth.isHost()) {
            throw ApiException.conflict("HOST_CANNOT_LEAVE", "El anfitrión debe cerrar la sesión en lugar de salir.");
        }
        if (!self) {
            requireHost(auth);
        }
        String reason = self ? "left" : "revoked";
        synchronized (s) {
            requireActive(s, auth);
            Participant p = requireGuest(s, participantId);
            if (!p.status.isActive()) {
                throw ApiException.conflict("INVALID_STATE", "El participante ya no está en la sesión.");
            }
            deactivate(p, self ? ParticipantStatus.LEFT : ParticipantStatus.REVOKED);
            log.info("Sesión {}: participante {} {}", s.id, p.id, reason);
        }
        events.publishEvent(new SessionEvents.ParticipantEvicted(s.id, participantId, reason));
        events.publishEvent(new SessionEvents.Changed(s.id, reason));
    }

    public SessionView setGamepadPermission(AuthContext auth, String sessionId, String participantId, boolean allowed) {
        Session s = sessionFor(auth, sessionId);
        requireHost(auth);
        SessionView view;
        synchronized (s) {
            Participant host = requireActive(s, auth);
            Participant p = requireGuest(s, participantId);
            if (p.status != ParticipantStatus.APPROVED) {
                throw ApiException.conflict("INVALID_STATE", "Solo se puede dar el mando a un invitado aprobado.");
            }
            p.gamepadAllowed = allowed;
            log.info("Sesión {}: mando {} para {}", s.id, allowed ? "concedido" : "retirado", p.id);
            view = viewFor(s, host);
        }
        events.publishEvent(new SessionEvents.Changed(s.id, "permissions"));
        return view;
    }

    public void closeSession(AuthContext auth, String sessionId) {
        Session s = sessionFor(auth, sessionId);
        requireHost(auth);
        synchronized (s) {
            requireActive(s, auth);
        }
        close(s, "closed-by-host");
    }

    private void close(Session s, String reason) {
        List<String> ids;
        synchronized (s) {
            if (s.closed) {
                return;
            }
            s.closed = true;
            ids = new ArrayList<>(s.participants.keySet());
            s.participants.values().forEach(p -> tokens.remove(p.tokenHash));
            s.invites.values().forEach(i -> inviteCodes.remove(i.codeHash));
            sessions.remove(s.id);
        }
        log.info("Sesión {} cerrada ({})", s.id, reason);
        events.publishEvent(new SessionEvents.Closed(s.id, ids, reason));
    }

    private void deactivate(Participant p, ParticipantStatus status) {
        p.status = status;
        p.gamepadAllowed = false;
        p.connected = false;
        tokens.remove(p.tokenHash);
    }

    // ---------------------------------------------------------------- WebRTC / señalización

    public IceConfig iceConfig(AuthContext auth, String sessionId) {
        Session s = sessionFor(auth, sessionId);
        synchronized (s) {
            Participant p = requireActive(s, auth);
            if (p.status != ParticipantStatus.APPROVED) {
                throw ApiException.forbidden("Espera a que el anfitrión te apruebe.");
            }
        }
        GameShareProperties.Turn turn = props.turn();
        List<IceServer> servers = new ArrayList<>();
        if (!turn.stunUrls().isEmpty()) {
            servers.add(new IceServer(turn.stunUrls(), null, null));
        }
        long ttl = turn.credentialTtl().toSeconds();
        if (turn.turnEnabled()) {
            long expires = clock.instant().getEpochSecond() + ttl;
            TurnCredentials.Credential c = TurnCredentials.create(turn.secret(), expires, auth.participantId());
            servers.add(new IceServer(turn.turnUrls(), c.username(), c.password()));
        }
        return new IceConfig(servers, ttl);
    }

    /** Solo se permite señalizar entre el anfitrión y un invitado aprobado de la misma sesión. */
    public boolean canSignal(String sessionId, String fromId, String toId) {
        Session s = sessions.get(sessionId);
        if (s == null || fromId.equals(toId)) {
            return false;
        }
        synchronized (s) {
            Participant from = s.participants.get(fromId);
            Participant to = s.participants.get(toId);
            if (s.closed || from == null || to == null || from.isHost() == to.isHost()) {
                return false;
            }
            return from.status == ParticipantStatus.APPROVED && to.status == ParticipantStatus.APPROVED;
        }
    }

    public void setConnected(String sessionId, String participantId, boolean connected) {
        Session s = sessions.get(sessionId);
        if (s == null) {
            return;
        }
        synchronized (s) {
            Participant p = s.participants.get(participantId);
            if (s.closed || p == null || !p.status.isActive() || p.connected == connected) {
                return;
            }
            p.connected = connected;
            s.lastActivity = clock.instant();
        }
        events.publishEvent(new SessionEvents.Changed(sessionId, connected ? "peer-online" : "peer-offline"));
    }

    public void recordStats(String sessionId, String participantId, ConnectionStats stats) {
        Session s = sessions.get(sessionId);
        if (s == null) {
            return;
        }
        synchronized (s) {
            Participant p = s.participants.get(participantId);
            if (s.closed || p == null || !p.status.isActive()) {
                return;
            }
            Instant now = clock.instant();
            p.stats = new ConnectionStats(stats.rttMs(), stats.fps(), stats.bitrateKbps(), stats.packetLossPct(),
                    stats.jitterMs(), now);
            s.lastActivity = now;
        }
        events.publishEvent(new SessionEvents.Changed(sessionId, "stats"));
    }

    // ---------------------------------------------------------------- mantenimiento

    /** Cierra las sesiones inactivas sin nadie conectado. */
    @Scheduled(fixedDelay = 60_000)
    public void expireIdleSessions() {
        Instant now = clock.instant();
        Duration ttl = props.sessionIdleTtl();
        for (Session s : List.copyOf(sessions.values())) {
            boolean expired;
            synchronized (s) {
                boolean anyoneConnected = s.participants.values().stream().anyMatch(p -> p.connected);
                expired = !anyoneConnected && s.lastActivity.plus(ttl).isBefore(now);
            }
            if (expired) {
                close(s, "expired");
            }
        }
    }

    int sessionCount() {
        return sessions.size();
    }

    // ---------------------------------------------------------------- helpers

    private Session sessionFor(AuthContext auth, String sessionId) {
        if (!auth.sessionId().equals(sessionId)) {
            throw ApiException.forbidden("Tu token no pertenece a esta sesión.");
        }
        Session s = sessions.get(sessionId);
        if (s == null) {
            throw ApiException.gone("SESSION_ENDED", "La sesión ya terminó.");
        }
        return s;
    }

    /** Se llama dentro del lock: revalida que quien llama sigue activo. */
    private static Participant requireActive(Session s, AuthContext auth) {
        Participant p = s.participants.get(auth.participantId());
        if (s.closed || p == null || !p.status.isActive()) {
            throw ApiException.unauthorized();
        }
        return p;
    }

    private static void requireHost(AuthContext auth) {
        if (!auth.isHost()) {
            throw ApiException.forbidden("Solo el anfitrión puede hacer esto.");
        }
    }

    private static Participant requireGuest(Session s, String participantId) {
        Participant p = s.participants.get(participantId);
        if (p == null || p.isHost()) {
            throw ApiException.notFound("PARTICIPANT_NOT_FOUND", "El participante no existe.");
        }
        return p;
    }
}
