# Criterios de aceptación y plan de pruebas

## Qué se puede probar en un solo PC y qué necesita dos

| Componente | 1 PC | 2 PC en la misma LAN | 2 PC en ciudades distintas |
|---|---|---|---|
| Backend: sesiones, invitaciones, autorización, señalización | ✅ pruebas automáticas | — | — |
| UI Electron: crear sala, unirse, aprobar, revocar | ✅ (dos ventanas/instancias) | — | — |
| WebRTC vídeo+audio | ✅ loopback (dos instancias) | ✅ latencia real LAN | ✅ NAT real |
| Mando virtual ViGEm | ✅ (aparece en `joy.cpl`) | ✅ | ✅ |
| Juego reconoce 2 jugadores | ✅ (mando físico + virtual) | ✅ | ✅ |
| STUN / TURN detrás de NAT | ❌ | parcial | ✅ **imprescindible** |
| Latencia y pérdida de paquetes | simulable (clumsy) | ✅ | ✅ |

## Criterio de éxito del MVP

1. El anfitrión crea una sesión.
2. El invitado se une con una invitación válida, y el anfitrión lo aprueba.
3. El invitado ve el juego con audio.
4. El mando del invitado aparece como un **segundo mando Xbox** independiente en el anfitrión.
5. Un juego cooperativo local reconoce a ambos jugadores.
6. Revocar corta vídeo y mando en < 1 s y libera todos los botones.
7. Los errores de conexión se muestran con un mensaje comprensible.

## Métricas objetivo (a medir, no medidas todavía)

| Métrica | Objetivo |
|---|---|
| Latencia de entrada (mando → juego) | < 30 ms en LAN, < RTT + 20 ms en Internet |
| Latencia de vídeo extremo a extremo | < 120 ms |
| FPS recibidos | ≥ 50 a 1080p (o 720p si el ancho de banda es bajo) |
| Pérdida de paquetes tolerada | ≤ 2 % sin cortes visibles |
| Tiempo de liberación de botones tras corte abrupto | ≤ 500 ms (watchdog) |

## Escenarios de prueba (fase 6)

Dos usuarios conectados · invitado no autorizado · invitación expirada o revocada/reutilizada · desconexión inesperada · latencia alta y pérdida de paquetes (simuladas con *clumsy*) · mando desconectado · reconexión · cierre de emergencia · NAT · TURN forzado (`iceTransportPolicy: "relay"`).
