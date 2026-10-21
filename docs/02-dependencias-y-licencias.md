# Dependencias y licencias

Estado verificado el 2026-10-20. Se revisará al añadir cada dependencia.

| Componente | Licencia | Cómo se usa | Notas |
|---|---|---|---|
| Spring Boot 3.x | Apache-2.0 | Backend | — |
| Electron | MIT | Contenedor de escritorio | Incluye Chromium (BSD) y libwebrtc (BSD) |
| Angular | MIT | UI | — |
| .NET 8 | MIT | input-agent | — |
| ViGEmBus (driver) | BSD-3-Clause | Driver instalado por el usuario; **no se redistribuye** | **Retirado/archivado desde 2023-11-02.** Funciona, pero no recibirá actualizaciones. Hay que desactivar su actualizador automático (el dominio vigem.org ya no pertenece al autor): usar la herramienta *Legacinator* de Nefarius |
| Nefarius.ViGEm.Client | MIT | NuGet en input-agent | Cliente en modo usuario |
| coturn | BSD-3-Clause | Contenedor TURN/STUN | Imagen oficial `coturn/coturn` |
| Sunshine | GPL-3.0 | *Futuro*, solo como proceso externo | No se enlaza ni se copia su código; así se evita contaminar la licencia |
| Moonlight | GPL-3.0 | *Futuro*, cliente externo | Ídem |
| Parsec | Propietaria (términos del servicio) | No se integra | Solo para validar manualmente el concepto, si sus términos lo permiten |

## Plan de sustitución de dependencias de riesgo

- **ViGEmBus:** todo el acceso pasa por la interfaz `GamepadBackend` del input-agent. Si aparece un sucesor mantenido por Nefarius u otro driver firmado, se añade una implementación nueva sin tocar Electron ni el protocolo.
- **Motor WebRTC → Sunshine:** la interfaz `StreamingEngine` permite lanzar Sunshine como proceso externo y que el invitado use Moonlight. Seguirían reutilizándose la sala, las invitaciones y el mando por DataChannel, o bien el soporte de mando de Sunshine.
- **Ninguna dependencia comercial** es obligatoria en el MVP.
