# Fase 6: pruebas reales entre dos PCs

Servidor: **Cloudflare Tunnel** en el PC del anfitrión (`scripts/start-server.ps1`). **No hay TURN**: el vídeo y el mando necesitan conexión directa entre los dos PCs (STUN). Si no conecta, el plan B es Tailscale o un VPS con coturn.

## Preparación

**Anfitrión**
1. `powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1` → anota el **Servidor** y la **Clave**.
2. GameShare → ⚙ Ajustes → pega el Servidor y la Clave → Guardar (la app se recarga).
3. Conecta **tu mando** antes que nada (serás el jugador 1).
4. Abre el juego en **ventana sin bordes**.

**Invitada**: instalar y unirse según [09-guia-invitada.md](09-guia-invitada.md).

Instalador: `desktop\release\GameShare-Setup-0.1.0.exe`. Se genera con `cd desktop; npm run dist`.

## Checklist (rellenar en la prueba; no hay resultados inventados)

| # | Prueba | Cómo | Esperado | Resultado |
|---|---|---|---|---|
| 1 | Conexión | Ella se une y tú la aceptas | Ve el juego; chip "Conexión directa (P2P)" | |
| 2 | Calidad | Mirar las estadísticas de los dos lados durante 5 min | ≥ 50 fps, pérdida < 2 %, codificador "hardware" | |
| 3 | Latencia de red | Estadística "latencia de red" | Anotar valor (ms) | |
| 4 | Latencia percibida | Ella pulsa saltar; ¿se nota retraso? | Jugable para un cooperativo | |
| 5 | Audio | Ella oye el juego y prueba silenciar | Estéreo, sin cortes | |
| 6 | Mando Xbox de ella | "Permitir mando" → el juego detecta al jugador 2 | Ambos jugadores en el juego | |
| 7 | Mando PS4 de ella | Igual que el 6, con el DualShock 4 | Ídem (con iconos de Xbox) | |
| 8 | Vibración | Algo que vibre en el juego | Su mando vibra | |
| 9 | Invitación usada o caducada | Reutilizar un enlace | Mensaje "ya se usó" | |
| 10 | Desconexión inesperada | Ella desconecta el WiFi 10 s con un botón pulsado | El jugador 2 suelta el botón; al volver, reconecta | |
| 11 | Mando desconectado | Ella desconecta el mando y lo vuelve a conectar | Vuelve a funcionar | |
| 12 | Revocar | Tú pulsas "Revocar acceso" | Su vídeo y su mando se cortan al instante | |
| 13 | Emergencia | Ctrl+Shift+F12 con la app en segundo plano | Todo se cierra; el mando virtual desaparece | |
| 14 | Red difícil | Si la 1 falla: anotar el tipo de conexión de cada uno (fibra, móvil, CGNAT) | Decidir el plan B | |

Latencia alta y pérdida simuladas (opcional): la herramienta *clumsy* (código abierto) en el PC de la invitada.
