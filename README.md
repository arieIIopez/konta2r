# konta2r

**Konta2r** es una plataforma abierta de visión artificial para observar, medir y auditar **movilidad, ocupación y vida pública**. Su objetivo es cuantificar no sólo cómo las personas y vehículos se desplazan, sino también cómo las personas permanecen, interactúan y utilizan los elementos del espacio público.

El proyecto nace de un prototipo en navegador basado en TensorFlow.js + COCO-SSD (`contador.html`). Ese prototipo demostró la viabilidad de detectar usuarios y contar cruces; la v2 lo reemplaza por una arquitectura modular con tracking, geometría versionada, inferencia ONNX, validación reproducible y una red Community de teléfonos reutilizados.

## Objetivo

Construir un instrumento reproducible para estudios de **movilidad y vida pública** capaz de transformar video en **entidades, trayectorias, relaciones, episodios y eventos auditables**, y al mismo tiempo permitir una red comunitaria que publique únicamente agregados anónimos por diseño.

Flujo local/profesional:

```text
video → detección → tracking
                    ├─ movilidad → geometría → eventos de flujo
                    └─ vida pública → relaciones → permanencia/actividad
                                      ↓
                             evidencia + validación
```

La rama de vida pública se inspira en la tradición Public Space / Public Life asociada a Jan Gehl: contar y mapear no sólo movimiento, sino también permanencia, actividades observables, relaciones entre personas y relación persona–espacio.

Flujo Community:

`cruces locales → bucket agregado → supresión de bajo conteo → outbox durable → backend`

## Principios

- **Privacidad por diseño:** la imagen permanece en el dispositivo; Community no persiste frames, bounding boxes, tracks, eventos individuales ni coordenadas exactas de cruce.
- **Trazabilidad:** cada medición profesional debe poder vincularse a modelo, configuración, geometría y sesión.
- **Reproducibilidad:** dependencias, modelos, metodología y configuración versionados.
- **Validez antes que apariencia:** precisión del instrumento y protocolo de validación por sobre una interfaz llamativa.
- **Arquitectura modular:** detector, tracker, clasificación modal, geometría y transporte Community son componentes separables.
- **Movilidad y vida pública:** peatones, bicicletas, ciclos, motocicletas, automóviles, buses y camiones se modelan como entidades de movilidad; personas, permanencias y relaciones persona–persona/persona–espacio pueden alimentar análisis Public Life.
- **Observación antes que interpretación:** Konta2r registra comportamientos y relaciones visualmente observables; categorías urbanísticas derivadas deben conservar su evidencia, reglas y nivel de incertidumbre.
- **Identidad separada:** la cuenta humana administra el nodo; el sensor opera con una credencial revocable propia.

## Estado

🧪 **Konta2r v2 — alpha integrada.**

`main` es la **fuente de verdad del proyecto** y contiene la versión integrada de Konta2r. Allí están implementados el runtime PWA, detector piloto ONNX/NanoDet, tracking multiobjeto, fusión modal, línea táctil versionada, conteos A→B/B→A, agregación Community privacy-first, outbox offline, lifecycle de nodos y Edge Functions Supabase.

El 26 de septiembre de 2026 se consolidó en `main` todo el desarrollo histórico que hasta entonces se había integrado en `develop`. Desde esa consolidación, `develop` queda deprecada y no debe utilizarse como base para nuevo trabajo.

El siguiente gate externo es desplegar y verificar todo contra un **proyecto Supabase dedicado a Konta2r**. El código no debe desplegarse sobre proyectos Supabase ajenos o reutilizados para otros fines.

## Flujo de desarrollo

Konta2r utiliza un flujo **main-first / trunk-based**:

```text
main
  ↑
pull request
  ↑
feature/* | fix/* | experiment/* | evidence/*
```

Reglas:

1. todo trabajo nuevo nace desde `main`;
2. las ramas de trabajo son temporales y de alcance acotado;
3. todo cambio vuelve a `main` mediante pull request;
4. después del merge, la rama temporal puede eliminarse si no contiene evidencia que deba preservarse;
5. `develop` no se usa para desarrollo nuevo;
6. las ramas `evidence/*` sólo se conservan cuando cumplen una función explícita de reproducibilidad o trazabilidad.

La política completa está en `docs/development-workflow.md`.

## Líneas de trabajo actuales

1. desplegar backend dedicado Konta2r y ejecutar E2E completo;
2. acumular evidencia de campo en teléfonos `eco / balanced / performance`;
3. cerrar benchmark científico de detector y tracking sobre corpus congelado;
4. calibrar fusión modal con ground truth;
5. desarrollar la línea **Public Life / Gehl**: permanencia, actividades observables, mapa semántico del espacio y relaciones persona–persona/persona–elemento urbano;
6. evaluar **RelateAnything** como `RelationProvider` experimental mediante benchmark contra reglas geométricas y solución híbrida;
7. extender geometría a polígonos/zonas;
8. avanzar a calibración espacial y métricas físicas cuando exista evidencia suficiente;
9. construir dashboard/mapa Community únicamente sobre datos agregados.

## Documentación clave

- `docs/roadmap.md` — hoja de ruta auditada contra el repositorio;
- `docs/development-workflow.md` — política de ramas y contribución main-first;
- `docs/counting-geometry.md` — geometría táctil, revisiones y conteo local;
- `docs/public-life-gehl.md` — marco de observación de vida pública, relaciones, permanencia y evaluación de RelateAnything;
- `docs/integrations/relateanything.md` — contrato ONNX, score, vocabulario dinámico, licencia y gates de la integración experimental;
- `docs/public-life-corpus.md` — diseño del corpus, splits, ground truth y auditoría de cobertura Public Life;
- `docs/public-life-annotation-protocol.md` — juicios explícitos positivo/negativo/incierto/no-observable y episodios de actividad;
- `docs/public-life-benchmark.md` — métricas comunes A/B/C/D para relaciones y episodios Public Life;
- `docs/community-public-life.md` — agregados Public Life privacy-first, supresión y persistencia Community;
- `docs/public-life-runtime.md` — orquestación experimental de tracks, mapa semántico, sampling, relaciones y episodios;
- `docs/community-flow-runtime.md` — frontera de agregación Community;
- `docs/community-node-provisioning.md` — enrolamiento, credencial sensor y recuperación;
- `docs/supabase-deployment.md` — runbook para el primer backend dedicado y E2E.

## Validación técnica

Cada cambio que se proponga integrar a `main` debe pasar:

- TypeScript estricto;
- chequeo Deno de las Edge Functions;
- pruebas unitarias;
- build de producción;
- gates adicionales específicos cuando se incorporen herramientas de despliegue o E2E.

La existencia de código o de un modelo no se interpreta como validación científica. Konta2r sólo declarará precisión, calidad o selección de modelo cuando exista evidencia reproducible.

## Origen

La primera versión fue desarrollada por Ariel López como una herramienta de conteo y observación de tránsito mediante visión artificial. La v2 toma esa experiencia como punto de partida y redefine el sistema para convertirlo en una plataforma de medición de movilidad reproducible y una infraestructura comunitaria de datos agregados.
