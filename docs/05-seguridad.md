# Modelo de amenazas y mitigaciones

Alcance: uso privado entre dos personas. El invitado **solo** debe recibir el streaming y controlar el mando virtual de la sesión activa.

Leyenda: ✅ implementado y probado · 🔜 planificado para una fase posterior.

| # | Amenaza | Mitigación | Estado |
|---|---|---|---|
| 1 | Un desconocido adivina una invitación | Código aleatorio de 128 bits (`SecureRandom`), caduca en 15 min, de un solo uso y revocable, con límite de 10 canjes/min por IP | ✅ |
| 2 | Se filtra una invitación (captura, chat) | De un solo uso, y además el anfitrión debe **aprobar** explícitamente al invitado | ✅ |
| 3 | Robo de un token del servidor (volcado de memoria) | Solo se guardan hashes SHA-256 de tokens y códigos | ✅ |
| 4 | Usar un token en otra sesión | Cada token está ligado a una sesión; cualquier otra devuelve 403 | ✅ |
| 5 | Un invitado realiza acciones del anfitrión | Comprobación de rol en cada operación | ✅ |
| 6 | Un invitado pendiente negocia WebRTC | La señalización y las credenciales ICE solo se dan a participantes aprobados | ✅ |
| 7 | Revocación lenta | Al revocar se invalida el token, se cierra el WebSocket (4403) y se retira el permiso de mando de forma inmediata | ✅ backend y app (e2e: la invitada queda fuera al instante) · 🔜 corte de WebRTC y del mando (fases 4–5) |
| 8 | Abuso del servidor o de TURN por terceros | `X-Host-Key` opcional para crear salas; credenciales TURN temporales (HMAC) solo para aprobados; coturn sin acceso a redes privadas | ✅ backend · 🔜 coturn sin probar |
| 9 | Inundación de mensajes / DoS | Rate limit REST por IP; *token bucket* por WebSocket con cierre 4429; límite de 64 KB por mensaje y 32 KB por señal; máximo de sesiones e invitaciones | ✅ |
| 10 | Mensajes malformados | Validación de DTOs (Bean Validation), JSON estricto, rangos numéricos en `stats` y tipos desconocidos rechazados | ✅ |
| 11 | Token en registros o URLs | El token del WebSocket va en el primer mensaje, no en la URL; los registros solo muestran IDs públicos | ✅ |
| 12 | Peticiones desde webs maliciosas (CSRF/CORS) | Lista blanca de orígenes para REST y WebSocket; sin cookies (Bearer) | ✅ |
| 13 | Espionaje en tránsito | HTTPS/WSS mediante un proxy TLS; el medio WebRTC siempre va cifrado (DTLS-SRTP), también a través de TURN | ✅ DTLS-SRTP (obligatorio en WebRTC) · 🔜 TLS en el despliegue del backend |
| 14 | Repetición o desorden de entradas del mando | Número de secuencia creciente, con descarte de `seq ≤ último` | 🔜 fase 5 |
| 15 | Botones "pegados" tras un corte | Watchdog de 500 ms → estado neutro; destrucción del mando al desconectar | 🔜 fase 5 |
| 16 | Entradas remotas convertidas en teclado o ratón | El agente de entrada solo expone un mando Xbox virtual (ViGEm); no hay API de teclado ni ratón | 🔜 fase 5 |
| 17 | El invitado accede a archivos, terminal o escritorio | No existe ningún canal para ello: solo vídeo/audio salientes y mensajes de mando entrantes | 🔜 se verificará en las fases 3–5 |
| 18 | Captura de ventanas privadas | El anfitrión elige la ventana o pantalla en un selector propio. La captura solo se autoriza para esa fuente y una sola vez; cualquier otra petición de captura se deniega; cámara y micrófono denegados | ✅ verificado con e2e |
| 18d | Señales WebRTC maliciosas | Validación estricta (tipo, tamaño y formato de SDP/ICE); la invitada solo acepta ofertas del anfitrión estando aprobada; conexiones `sendonly` (la invitada no puede enviar medios) | ✅ |
| 18e | Audio privado del anfitrión | Se captura TODO el audio del sistema (limitación de Windows/Chromium): notificaciones y llamadas incluidas. El anfitrión puede cortar el audio enviado con un clic | ⚠ documentado |
| 18b | XSS o código remoto en la app de escritorio | Sandbox + contextIsolation, sin Node en la interfaz, CSP estricta, IPC con verificación de origen, sin ventanas ni navegación externas | ✅ verificado con e2e |
| 18c | Invitación maliciosa que redirige a otro servidor | La app muestra el servidor y pide confirmación explícita; solo admite http/https | ✅ |
| 19 | Secretos en el repositorio | Variables de entorno; `.env` en `.gitignore`; solo se versiona `.env.example` | ✅ |
| 20 | Actualizador de ViGEmBus que contacta un dominio ajeno | Desactivarlo con *Legacinator* (ver docs/02) | 🔜 documentado, falta comprobarlo en esta PC |

## Limitaciones conocidas

- Cualquiera que conozca la URL del backend puede crear salas si no se define `GAMESHARE_HOST_KEY`. **Recomendado:** definirla en producción.
- El estado en memoria se pierde al reiniciar el backend. Las sesiones activas tendrían que crearse de nuevo, aunque los streams P2P ya establecidos no se cortan.
- Una sola instancia del backend: no escala horizontalmente. Es suficiente para el caso de uso.
