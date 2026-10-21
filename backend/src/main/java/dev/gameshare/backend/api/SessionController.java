package dev.gameshare.backend.api;

import dev.gameshare.backend.session.AuthContext;
import dev.gameshare.backend.session.SessionService;
import dev.gameshare.backend.session.Views.Credentials;
import dev.gameshare.backend.session.Views.IceConfig;
import dev.gameshare.backend.session.Views.InviteView;
import dev.gameshare.backend.session.Views.SessionView;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class SessionController {

    private final SessionService sessions;

    public SessionController(SessionService sessions) {
        this.sessions = sessions;
    }

    // ---- sesiones

    @PostMapping("/sessions")
    @ResponseStatus(HttpStatus.CREATED)
    public Credentials create(@RequestHeader(name = "X-Host-Key", required = false) String hostKey,
                              @Valid @RequestBody Requests.CreateSession body) {
        sessions.checkHostKey(hostKey);
        return sessions.createSession(body.displayName().trim());
    }

    @GetMapping("/sessions/{sessionId}")
    public SessionView get(AuthContext auth, @PathVariable String sessionId) {
        return sessions.view(auth, sessionId);
    }

    /** Cierre de la sesión, también de emergencia: expulsa a todos e invalida tokens e invitaciones. */
    @DeleteMapping("/sessions/{sessionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void close(AuthContext auth, @PathVariable String sessionId) {
        sessions.closeSession(auth, sessionId);
    }

    @GetMapping("/sessions/{sessionId}/ice-servers")
    public IceConfig iceServers(AuthContext auth, @PathVariable String sessionId) {
        return sessions.iceConfig(auth, sessionId);
    }

    // ---- invitaciones

    @PostMapping("/sessions/{sessionId}/invites")
    @ResponseStatus(HttpStatus.CREATED)
    public InviteView createInvite(AuthContext auth, @PathVariable String sessionId) {
        return sessions.createInvite(auth, sessionId);
    }

    @GetMapping("/sessions/{sessionId}/invites")
    public List<InviteView> listInvites(AuthContext auth, @PathVariable String sessionId) {
        return sessions.listInvites(auth, sessionId);
    }

    @DeleteMapping("/sessions/{sessionId}/invites/{inviteId}")
    public InviteView revokeInvite(AuthContext auth, @PathVariable String sessionId, @PathVariable String inviteId) {
        return sessions.revokeInvite(auth, sessionId, inviteId);
    }

    @PostMapping("/invites/redeem")
    @ResponseStatus(HttpStatus.CREATED)
    public Credentials redeem(@Valid @RequestBody Requests.RedeemInvite body) {
        return sessions.redeem(body.code(), body.displayName().trim());
    }

    // ---- participantes

    @PostMapping("/sessions/{sessionId}/participants/{participantId}/approve")
    public SessionView approve(AuthContext auth, @PathVariable String sessionId, @PathVariable String participantId) {
        return sessions.approve(auth, sessionId, participantId);
    }

    @PostMapping("/sessions/{sessionId}/participants/{participantId}/reject")
    public SessionView reject(AuthContext auth, @PathVariable String sessionId, @PathVariable String participantId) {
        return sessions.reject(auth, sessionId, participantId);
    }

    /** El anfitrión revoca a un invitado, o el invitado sale él mismo. */
    @DeleteMapping("/sessions/{sessionId}/participants/{participantId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(AuthContext auth, @PathVariable String sessionId, @PathVariable String participantId) {
        sessions.removeParticipant(auth, sessionId, participantId);
    }

    @PutMapping("/sessions/{sessionId}/participants/{participantId}/permissions")
    public SessionView permissions(AuthContext auth, @PathVariable String sessionId,
                                   @PathVariable String participantId,
                                   @Valid @RequestBody Requests.Permissions body) {
        return sessions.setGamepadPermission(auth, sessionId, participantId, body.gamepad());
    }
}
