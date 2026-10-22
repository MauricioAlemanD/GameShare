# GameShare — Remote Play privado para Windows

Aplicación privada para que dos personas jueguen en cooperativo local por Internet. El anfitrión ejecuta el juego, y el invitado recibe vídeo y audio y controla un segundo mando virtual.

## Estado

| Fase | Estado |
|---|---|
| 1. Validación técnica | ✅ Documentada |
| 2. Backend MVP | ✅ Implementado · 41 pruebas automáticas en verde |
| 3. Cliente de escritorio | ✅ Electron + Angular · 50 pruebas (34 unitarias, 5 Electron, 11 e2e con 2 instancias reales) |
| 4. Streaming | ✅ WebRTC con NVENC (H.264 High por hardware) + audio estéreo · probado en 1 PC · ⏳ falta validar con 2 PCs |
| 5. Mando remoto | ✅ Mando Xbox virtual (ViGEmBus) verificado con XInput real · ⏳ falta probar con los mandos físicos de la invitada |
| 6. Pruebas reales | ⏳ Pendiente |

## Estructura

```
backend/   Spring Boot 4 (Java 21): sesiones, invitaciones, señalización WebSocket
desktop/   Electron 44 + Angular 21: app de escritorio para anfitrión e invitado
input-agent/ .NET 8: proceso aislado que crea los mandos Xbox virtuales (ViGEmBus)
deploy/    docker-compose (backend + coturn) y .env.example
docs/      arquitectura, licencias, criterios, backend, seguridad
```

## Inicio rápido (backend)

```powershell
cd backend
.\mvnw.cmd test             # ejecuta las pruebas
.\mvnw.cmd spring-boot:run  # http://localhost:8080/actuator/health
```

## Inicio rápido (app de escritorio)

```powershell
cd desktop
npm install
npm start                   # abre la app (con el backend arrancado en localhost:8080)
```

Para probar anfitrión e invitado en el mismo PC, consulta [docs/06-escritorio.md](docs/06-escritorio.md#dos-instancias-en-el-mismo-pc).

## Documentación

- [Arquitectura y decisiones](docs/01-arquitectura.md)
- [Dependencias y licencias](docs/02-dependencias-y-licencias.md)
- [Criterios de aceptación y pruebas](docs/03-criterios-aceptacion.md)
- [Backend: API, WebSocket y despliegue](docs/04-backend.md)
- [Seguridad: amenazas y mitigaciones](docs/05-seguridad.md)
- [App de escritorio: comandos, estructura y seguridad](docs/06-escritorio.md)
- [Streaming: diseño, códecs medidos, latencia y limitaciones](docs/07-streaming.md)
- [Mando remoto: instalación de ViGEmBus, seguridad y pruebas](docs/08-mando-remoto.md)

## Requisitos (Windows)

- Java 21 (Maven no hace falta: se usa `mvnw.cmd`)
- Node 20+ (probado con 24) y .NET 8 SDK, para las fases siguientes
- Driver **ViGEmBus** en el PC anfitrión (ver el [estado de retirado](docs/02-dependencias-y-licencias.md))
- Docker (opcional, para el despliegue con coturn)
