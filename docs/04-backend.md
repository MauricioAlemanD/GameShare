# Backend de coordinación

Spring Boot 4.1 · Java 21 · estado en memoria (sin base de datos).

## Comandos (Windows, PowerShell)

```powershell
cd backend
.\mvnw.cmd test                      # 41 pruebas (unitarias + integración REST/WebSocket)
.\mvnw.cmd spring-boot:run           # arranca en http://localhost:8080
.\mvnw.cmd package                   # genera target\backend-0.0.1-SNAPSHOT.jar
java -jar target\backend-0.0.1-SNAPSHOT.jar
```

Variables de entorno (todas opcionales en desarrollo):

| Variable | Por defecto | Uso |
|---|---|---|
| `PORT` | 8080 | Puerto HTTP |
| `GAMESHARE_ALLOWED_ORIGINS` | `http://localhost:4200,app://gameshare` | CORS y orígenes WebSocket |
| `GAMESHARE_HOST_KEY` | vacía (sin restricción) | Si se define, `POST /api/sessions` exige la cabecera `X-Host-Key` |
| `GAMESHARE_STUN_URLS` | `stun:stun.l.google.com:19302` | Servidores STUN |
| `GAMESHARE_TURN_URLS` | vacía | Servidores TURN |
| `GAMESHARE_TURN_SECRET` | vacía (TURN desactivado) | Secreto compartido con coturn |
| `FORWARD_HEADERS_STRATEGY` | `none` | `native` detrás de un proxy inverso |

## API REST

Autenticación: `Authorization: Bearer <token>`. Todos los errores tienen el formato `{"error": "CODIGO", "message": "texto"}`.

| Método | Ruta | Quién | Descripción |
|---|---|---|---|
| POST | `/api/sessions` `{displayName}` | cualquiera (o con `X-Host-Key`) | Crea una sesión → `{sessionId, participantId, role, status, token}` |
| GET | `/api/sessions/{id}` | miembro | Estado de la sesión |
| DELETE | `/api/sessions/{id}` | anfitrión | **Cierre de emergencia**: expulsa a todos e invalida tokens e invitaciones |
| POST | `/api/sessions/{id}/invites` | anfitrión | Crea una invitación → incluye `code` **solo en esta respuesta** |
| GET | `/api/sessions/{id}/invites` | anfitrión | Lista las invitaciones (sin códigos) con su estado `ACTIVE/USED/REVOKED/EXPIRED` |
| DELETE | `/api/sessions/{id}/invites/{inviteId}` | anfitrión | Revoca una invitación |
| POST | `/api/invites/redeem` `{code, displayName}` | cualquiera | Canjea → token de invitado en estado `PENDING` |
| POST | `/api/sessions/{id}/participants/{pid}/approve` | anfitrión | Aprueba al invitado |
| POST | `/api/sessions/{id}/participants/{pid}/reject` | anfitrión | Rechaza al invitado pendiente |
| DELETE | `/api/sessions/{id}/participants/{pid}` | anfitrión (revocar) o el propio invitado (salir) | Expulsión inmediata |
| PUT | `/api/sessions/{id}/participants/{pid}/permissions` `{gamepad}` | anfitrión | Concede o retira el mando |
| GET | `/api/sessions/{id}/ice-servers` | anfitrión o invitado aprobado | STUN + credenciales TURN temporales |
| GET | `/actuator/health` | público | Salud |

Códigos de error relevantes para la UI: `UNAUTHORIZED`, `FORBIDDEN`, `INVITE_NOT_FOUND`, `INVITE_USED`, `INVITE_EXPIRED`, `INVITE_REVOKED`, `SESSION_ENDED`, `SESSION_FULL`, `TOO_MANY_INVITES`, `INVALID_STATE`, `VALIDATION_ERROR`, `RATE_LIMITED`, `HOST_KEY_INVALID`.

## WebSocket `/ws`

1. Al conectar, enviar `{"type":"auth","token":"..."}` en menos de 5 s. El token no va en la URL para que no quede en los registros.
2. El servidor responde `{"type":"auth-ok","participantId","role","session":{...}}`.

| Cliente → servidor | Descripción |
|---|---|
| `{"type":"signal","to":"<pid>","data":{...}}` | SDP/ICE. Solo entre el anfitrión y un invitado **aprobado**. Máximo 32 KB |
| `{"type":"stats","data":{rttMs,fps,bitrateKbps,packetLossPct,jitterMs}}` | Calidad de la conexión (solo se guarda la última) |
| `{"type":"ping"}` | Keepalive (enviar cada ~20 s; sin actividad durante 60 s se cierra la conexión) |

| Servidor → cliente | Descripción |
|---|---|
| `session-updated` `{reason, session}` | `reason`: `join-request`, `approved`, `rejected`, `revoked`, `left`, `permissions`, `peer-online`, `peer-offline`, `stats` |
| `signal` `{from, data}` | Mensaje del otro extremo |
| `evicted` `{reason}` | Te han revocado o rechazado; después se cierra con el código 4403 |
| `session-closed` `{reason}` | Sesión terminada; después se cierra con el código 4410 |
| `error` `{code, message}` | `MALFORMED`, `SIGNAL_FORBIDDEN`, `PEER_OFFLINE`, `RATE_LIMITED`, … |

Códigos de cierre: `4401` no autenticado · `4403` expulsado · `4409` sustituido por una reconexión · `4410` sesión cerrada · `4429` exceso de mensajes.

**Reconexión:** el cliente vuelve a conectar con el mismo token; la conexión nueva sustituye a la anterior.

## Despliegue (VPS Linux)

```bash
cd deploy
cp .env.example .env    # rellenar PUBLIC_HOST y GAMESHARE_TURN_SECRET
docker compose up -d --build
```

- El backend queda en `127.0.0.1:8080`. Pon delante un proxy con TLS. Por ejemplo, el `Caddyfile` mínimo es:
  ```
  gameshare.example.com {
      reverse_proxy 127.0.0.1:8080
  }
  ```
  y define `FORWARD_HEADERS_STRATEGY=native` para que el rate limit vea la IP real.
- Abre en el firewall: TCP 443 (Caddy), TCP/UDP 3478 (STUN/TURN) y UDP 49160–49200 (relay TURN).
- `network_mode: host` de coturn solo funciona en Linux.

> **Estado:** el `docker-compose.yml` es válido sintácticamente (`docker compose config`), pero **no se ha levantado todavía**, porque el daemon de Docker no estaba en ejecución durante el desarrollo.
