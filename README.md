# konta2r

**Konta2r** es una plataforma abierta de visión artificial para observar, medir y auditar movilidad y uso del espacio público.

El proyecto nace de un prototipo en navegador basado en TensorFlow.js + COCO-SSD (`contador.html`). Ese prototipo demostró la viabilidad de detectar usuarios y contar cruces; la v2 lo reemplaza por una arquitectura modular con tracking, geometría versionada, inferencia ONNX, validación reproducible y una red Community de teléfonos reutilizados.

## Objetivo

Construir un instrumento reproducible para estudios de movilidad capaz de transformar video en **entidades, trayectorias y eventos auditables**, y al mismo tiempo permitir una red comunitaria que publique únicamente agregados anónimos por diseño.

Flujo local/profesional:

`video → detección → asociación modal → tracking → motor espacial → eventos → evidencia/validación`

Flujo Community:

`cruces locales → bucket agregado → supresión de bajo conteo → outbox durable → backend`

## Principios

- **Privacidad por diseño:** la imagen permanece en el dispositivo; Community no persiste frames, bounding boxes, tracks, eventos individuales ni coordenadas exactas de cruce.
- **Trazabilidad:** cada medición profesional debe poder vincularse a modelo, configuración, geometría y sesión.
- **Reproducibilidad:** dependencias, modelos, metodología y configuración versionados.
- **Validez antes que apariencia:** precisión del instrumento y protocolo de validación por sobre una interfaz llamativa.
- **Arquitectura modular:** detector, tracker, clasificación modal, geometría y transporte Community son componentes separables.
- **Orientación a movilidad:** peatones, bicicletas, ciclos, motocicletas, automóviles, buses, camiones y otras categorías se modelan como entidades de movilidad evitando dobles conteos.
- **Identidad separada:** la cuenta humana administra el nodo; el sensor opera con una credencial revocable propia.

## Estado

🧪 **Konta2r v2 — alpha integrada.**

En `develop` ya están implementados el runtime PWA, detector piloto ONNX/NanoDet, tracking multiobjeto, fusión modal, línea táctil versionada, conteos A→B/B→A, agregación Community privacy-first, outbox offline, lifecycle de nodos y Edge Functions Supabase.

El siguiente gate externo es desplegar y verificar todo contra un **proyecto Supabase dedicado a Konta2r**. El código no debe desplegarse sobre proyectos Supabase ajenos o reutilizados para otros fines.

## Líneas de trabajo actuales

1. desplegar backend dedicado Konta2r y ejecutar E2E completo;
2. acumular evidencia de campo en teléfonos `eco / balanced / performance`;
3. cerrar benchmark científico de detector y tracking sobre corpus congelado;
4. calibrar fusión modal con ground truth;
5. extender geometría a polígonos/zonas;
6. avanzar a calibración espacial y métricas físicas cuando exista evidencia suficiente;
7. construir dashboard/mapa Community únicamente sobre datos agregados.

## Documentación clave

- `docs/roadmap.md` — hoja de ruta auditada contra el repositorio;
- `docs/counting-geometry.md` — geometría táctil, revisiones y conteo local;
- `docs/community-flow-runtime.md` — frontera de agregación Community;
- `docs/community-node-provisioning.md` — enrolamiento, credencial sensor y recuperación;
- `docs/supabase-deployment.md` — runbook para el primer backend dedicado y E2E.

## Validación técnica

Cada cambio integrado a `develop` debe pasar:

- TypeScript estricto;
- chequeo Deno de las Edge Functions;
- pruebas unitarias;
- build de producción;
- gates adicionales específicos cuando se incorporen herramientas de despliegue o E2E.

La existencia de código o de un modelo no se interpreta como validación científica. Konta2r sólo declarará precisión, calidad o selección de modelo cuando exista evidencia reproducible.

## Origen

La primera versión fue desarrollada por Ariel López como una herramienta de conteo y observación de tránsito mediante visión artificial. La v2 toma esa experiencia como punto de partida y redefine el sistema para convertirlo en una plataforma de medición de movilidad reproducible y una infraestructura comunitaria de datos agregados.
