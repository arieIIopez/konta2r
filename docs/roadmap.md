# Hoja de ruta Konta2r v2

> Estado auditado contra el repositorio el **2026-09-02**. Un `[x]` significa que existe una implementación verificable en código/tests; no implica que la fase esté científicamente cerrada. Los ítems de benchmark/validación sólo se consideran completos cuando existe evidencia reproducible, no por mera existencia de código.

## Fase 0 — Fundación

**Objetivo:** transformar el prototipo monolítico en un proyecto reproducible.

- [x] definir arquitectura modular;
- [x] documentar metodología de medición;
- [x] auditar el baseline `contador.html`;
- [x] crear scaffold TypeScript/Vite;
- [x] configurar tests, typecheck y CI;
- [ ] consolidar un esquema único de configuración de levantamiento versionado;
- [ ] preservar/publicar el prototipo original como referencia histórica autocontenida si aún no está disponible como artefacto del repo.

**Estado:** criterio técnico de salida cumplido: el proyecto compila, ejecuta tests y separa dominio, geometría, tracking, inferencia, Community y UI.

---

## Fase 1 — Motor geométrico y eventos

**Objetivo:** corregir primero aquello que determina qué constituye un conteo.

- [x] coordenadas normalizadas consistentes;
- [x] intersección segmento–segmento;
- [x] distancia/posición respecto de línea en espacio canónico;
- [x] histéresis/deadzone espacial;
- [x] líneas orientadas con A/B;
- [ ] polígonos de observación productivos;
- [x] evento `line_crossing`;
- [ ] eventos `zone_enter` / `zone_exit`;
- [x] tests unitarios con trayectorias sintéticas;
- [x] prevención de doble conteo por oscilación mediante intervalo mínimo/deadzone;
- [x] adaptación de geometría normalizada a cambios de resolución/aspect ratio dentro del motor de conteo.

**Estado:** el conteo por línea está implementado; faltan zonas/polígonos y, sobre todo, una UI de terreno para definir la geometría real antes de publicar conteos Community.

---

## Fase 2 — Tracking multiobjeto

**Objetivo:** mantener identidades estables bajo movimiento, interacción y oclusión breve.

- [x] estados tentative/confirmed/lost/removed;
- [x] modelo de movimiento/velocidad;
- [x] asignación global (Hungarian);
- [x] asociación en dos etapas para detecciones de distinta confianza;
- [x] historial temporal;
- [x] recuperación básica tras pérdida/oclusión breve;
- [x] métricas de identidad: ID precision/recall/F1, ID switches y fragmentación;
- [ ] benchmark representativo con secuencias anotadas y comparación formal contra tracker legacy;
- [ ] fijar criterio cuantitativo de aceptación de tracking por estrato de escena.

**Estado:** motor y métricas existen; falta cerrar la evidencia experimental.

---

## Fase 3 — Runtime y detector

**Objetivo:** sustituir la dependencia directa de COCO-SSD por una interfaz reproducible y eficiente.

- [x] interfaz/adapter `Detector`;
- [x] ONNX Runtime Web;
- [x] WebGPU cuando está disponible;
- [x] fallback WASM;
- [x] registro de candidatos con identidad, SHA-256 y gates de licencia;
- [x] probing ONNX reproducible y runtime smoke;
- [x] benchmark local reproducible contra video + ground truth + manifest congelado;
- [x] análisis de precision/recall/F1, latencia, FPS, estratos y confidence sweep en el benchmark;
- [x] metadata/hash del modelo;
- [x] configuración explícita de confidence/NMS/postproceso por adapter;
- [x] piloto de terreno NanoDet externo, opt-in y SHA-verificado;
- [x] cache local del checkpoint con re-verificación SHA-256;
- [x] registro durable de rendimiento del piloto en teléfonos y exportación JSON local;
- [ ] ejecutar corpus comparativo suficiente entre candidatos;
- [ ] cerrar licencia de redistribución de los pesos de los candidatos finalistas;
- [ ] seleccionar detector(es) por perfil `eco` / `balanced` / `performance` con evidencia.

**Estado:** la infraestructura de decisión ya existe. El siguiente trabajo no es agregar otro detector por popularidad, sino producir evidencia comparable en corpus y dispositivos reales.

---

## Fase 4 — Entidades de movilidad

**Objetivo:** pasar de clases visuales a usuarios modales.

- [x] asociación geométrica `person + bicycle → cyclist`;
- [x] asociación `person + motorcycle → motorcyclist`;
- [x] asociación `person + skateboard → skater` cuando la clase existe;
- [x] evitar doble emisión persona–vehículo para pares fusionados;
- [x] confidence de asociación modal basada en detector + compatibilidad geométrica;
- [ ] diferenciar de forma validada bicicleta montada vs bicicleta caminada;
- [ ] reglas temporales de fusión/separación más allá de la asociación por frame;
- [ ] calibrar thresholds de fusión con corpus anotado;
- [ ] matriz de confusión por modo de movilidad.

**Estado:** fusión modal base implementada, todavía no científicamente calibrada.

---

## Fase 5 — Persistencia, auditoría y privacidad

**Objetivo:** hacer los resultados reproducibles sin convertir el sistema comunitario en un repositorio de trazas identificables.

### Evidencia profesional/local

- [x] IndexedDB utilizado con esquemas/migraciones en subsistemas locales;
- [x] persistencia durable del outbox Community;
- [x] secuencia/idempotencia durable para publicación Community;
- [x] cache ONNX local verificado;
- [x] registro durable de sesiones de rendimiento del piloto;
- [ ] manifest único de sesión profesional;
- [ ] event store profesional normalizado;
- [ ] trajectories store profesional;
- [ ] geometries store profesional;
- [ ] annotations store separado y enlazado al manifest;
- [ ] exportación profesional CSV/JSON/JSONL integrada desde una sesión completa;
- [ ] hash único de configuración de levantamiento;
- [ ] auditoría audiovisual opcional y explícitamente separada del modo Community.

### Community

- [x] buckets locales agregados sin persistir track/event/session IDs ni imágenes;
- [x] supresión de celdas de bajo conteo;
- [x] publicación crash-idempotent bucket → outbox;
- [x] aislamiento de buckets por `nodeId` frente a reprovisión;
- [x] telemetría/runtime metadata sin inventar sensores inaccesibles al navegador;
- [x] calidad marcada como provisional mientras falte ground truth independiente.

**Estado:** el modo Community ya tiene una frontera de privacidad mucho más estricta que el modo profesional/local. No deben confundirse ambos objetivos de persistencia.

---

## Fase 6 — Interfaz de terreno / PWA

**Objetivo:** operación rápida, robusta y offline.

- [x] instalación/arquitectura PWA y service worker;
- [x] pantalla principal de cámara;
- [x] perfiles adaptativos `eco` / `balanced` / `performance`;
- [x] panel de calidad: FPS, p50 de cadencia, latencia p95, drops y backend;
- [x] estado/persistencia de almacenamiento;
- [x] continuidad, gaps, wake lock y red;
- [x] operación del piloto detector desde la pantalla de nodo;
- [x] exportación local de evidencia de rendimiento del piloto;
- [x] UI de administración de nodo Community separando auth humana de credencial sensor;
- [ ] creación táctil de líneas y polígonos sobre cámara;
- [ ] selector/overlay configurable de categorías visibles;
- [ ] modo oscuro/alto contraste específico de terreno;
- [ ] exportación completa de sesión profesional;
- [ ] importación de configuración de levantamiento;
- [ ] recuperación integral de una sesión profesional tras cierre accidental.

**Estado:** el nodo ya funciona como runtime/PWA; el próximo gran faltante visible es la configuración geométrica de terreno.

---

## Fase 7 — Calibración y métricas espaciales

**Objetivo:** pasar de píxeles a magnitudes físicas cuando exista evidencia geométrica suficiente.

- [ ] calibración por cuatro o más puntos conocidos;
- [ ] homografía al plano de suelo;
- [ ] diagnóstico de error de reproyección;
- [ ] velocidad métrica;
- [ ] distancia recorrida en área calibrada;
- [ ] mapas de trayectorias;
- [ ] densidad/ocupación espacial;
- [ ] intervalos de seguimiento y headways donde corresponda.

**Criterio de salida:** métricas físicas sólo se muestran cuando la calibración cumple un umbral de calidad definido.

---

## Fase 8 — Validación científica

**Objetivo:** conocer el error, no ocultarlo.

- [x] infraestructura de anotación/revisión de corpus;
- [x] manifests y splits para separar desarrollo, selección y held-out test;
- [x] benchmark local de detector con precision/recall/F1 e IoU;
- [x] métricas de tracking IDF1-equivalente, ID switches y fragmentación;
- [x] estratificación y confidence sweep disponibles en reportes de detector;
- [x] evidencia de campo de rendimiento sin imágenes para pruebas prolongadas de dispositivos;
- [ ] corpus representativo suficiente de escenas de movilidad;
- [ ] protocolo final de ground truth documentado y congelado;
- [ ] error de conteo por clase/sentido sobre pipeline completo;
- [ ] matriz de confusión de entidades modales;
- [ ] benchmark de tracking sobre corpus anotado;
- [ ] error de permanencia;
- [ ] error de velocidad cuando exista calibración;
- [ ] ensayo sostenido por estratos de dispositivo (30 min, 2 h y prolongado);
- [ ] informe reproducible de validación de una versión candidata profesional.

**Estado:** las herramientas de validación existen; falta generar el corpus/evidencia suficiente para convertirlas en resultados científicos defendibles.

---

## Fase 9 — Red Community

**Objetivo:** permitir una red distribuida de teléfonos reutilizados que aporte datos agregados, auditables y anónimos por diseño.

- [x] separación identidad humana / identidad sensor;
- [x] enrolamiento recuperable y lifecycle `provisioning / active / paused / revoked`;
- [x] rotación/revocación de credencial sin cambiar `nodeId`;
- [x] credencial sensor dedicada `Konta2rNode`;
- [x] HMAC/pepper versionado; backend no almacena token crudo;
- [x] Edge Functions para enrolamiento, lifecycle e ingestión;
- [x] outbox offline y reintentos;
- [x] protocolo agregado Community v2;
- [x] buckets de flujo privacy-first;
- [x] publicación idempotente y aislamiento por identidad;
- [x] UI local de administración Community;
- [ ] conectar conteos Community a una línea creada/configurada realmente en terreno;
- [ ] desplegar Supabase en un proyecto dedicado Konta2r;
- [ ] pruebas E2E contra ese backend dedicado;
- [ ] dashboard/mapa comunitario de agregados;
- [ ] política pública de retención, calidad y gobernanza de la red.

**Bloqueo externo actual:** no se desplegará en el proyecto Supabase ajeno ya conectado. La creación del proyecto dedicado Konta2r requiere escoger organización y completar el flujo de costo/confirmación antes del despliegue.

---

# Prioridad inmediata actualizada

El orden anterior `geometría → tracking → detector → fusión modal → almacenamiento → interfaz` ya produjo implementaciones funcionales en esos componentes. Desde este punto la prioridad cambia de **construir piezas aisladas** a **cerrar evidencia e integración de terreno**:

1. **ensayos reales del piloto en teléfonos `eco / balanced / performance`** y acumulación de evidencia durable;
2. **benchmark científico de detector y tracking** sobre corpus congelado;
3. **calibración de fusión modal** con ground truth;
4. **editor táctil de línea/polígono** y configuración versionada de levantamiento;
5. conectar esa geometría real al pipeline `EdgeMobilityPipeline → CommunityFlowBucketPublisher`;
6. desplegar backend dedicado Konta2r y ejecutar E2E cuando exista proyecto Supabase autorizado;
7. recién entonces consolidar modelos por perfil y avanzar a métricas espaciales/calibración.

La regla metodológica se mantiene: Konta2r no declarará precisión, calidad, anonimato ni selección de modelo por intuición. Cada afirmación deberá corresponder a una métrica reproducible o a una garantía explícita de arquitectura.
