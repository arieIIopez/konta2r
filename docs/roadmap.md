# Hoja de ruta Konta2r v2

## Fase 0 — Fundación

**Objetivo:** transformar el prototipo monolítico en un proyecto reproducible.

- [x] definir arquitectura modular;
- [x] documentar metodología de medición;
- [x] auditar el baseline `contador.html`;
- [ ] crear scaffold TypeScript/Vite;
- [ ] configurar lint, tests y CI;
- [ ] definir esquema de configuración versionado;
- [ ] preservar el prototipo original como referencia histórica.

**Criterio de salida:** proyecto compila, ejecuta tests y separa dominio, geometría, tracking, inferencia y UI.

---

## Fase 1 — Motor geométrico y eventos

**Objetivo:** corregir primero aquello que determina qué constituye un conteo.

- [ ] coordenadas normalizadas consistentes;
- [ ] intersección segmento–segmento;
- [ ] distancia perpendicular real a línea;
- [ ] histéresis espacial;
- [ ] líneas orientadas con A/B;
- [ ] polígonos de observación;
- [ ] eventos `line_crossing`, `zone_enter`, `zone_exit`;
- [ ] tests unitarios con trayectorias sintéticas;
- [ ] prevención de doble conteo por oscilación.

**Criterio de salida:** 100% de los escenarios geométricos sintéticos esperados pasan tests determinísticos.

---

## Fase 2 — Tracking multiobjeto

**Objetivo:** mantener identidades estables bajo movimiento, interacción y oclusión breve.

- [ ] estados tentative/confirmed/lost/removed;
- [ ] modelo de movimiento;
- [ ] asignación global;
- [ ] asociación en dos etapas para detecciones de distinta confianza;
- [ ] historial temporal;
- [ ] recuperación tras oclusión;
- [ ] métricas de fragmentación e ID switches;
- [ ] benchmark con secuencias anotadas.

**Criterio de salida:** mejora demostrable frente al tracker legacy en IDF1/fragmentación y conteo.

---

## Fase 3 — Runtime y detector

**Objetivo:** sustituir la dependencia directa de COCO-SSD por una interfaz reproducible y eficiente.

- [ ] adapter `Detector`;
- [ ] ONNX Runtime Web;
- [ ] WebGPU cuando esté disponible;
- [ ] fallback WASM;
- [ ] benchmark de modelos candidatos;
- [ ] selección considerando precisión, latencia, tamaño y licencia;
- [ ] metadata/hash del modelo;
- [ ] configuración de NMS y confidence explícita.

**Criterio de salida:** detector seleccionable por configuración, benchmark documentado y sin dependencia implícita de CDN.

---

## Fase 4 — Entidades de movilidad

**Objetivo:** pasar de clases visuales a usuarios modales.

- [ ] asociación `person + bicycle → cyclist`;
- [ ] asociación `person + motorcycle → motorcyclist` cuando corresponda;
- [ ] diferenciar bicicleta montada de bicicleta caminada;
- [ ] tratar patinetas/ciclos como entidad compuesta;
- [ ] evitar dobles conteos persona–vehículo;
- [ ] confidence de asociación modal;
- [ ] reglas temporales de fusión y separación.

**Criterio de salida:** matriz de confusión por modo y reducción cuantificada de dobles conteos.

---

## Fase 5 — Persistencia y auditoría

**Objetivo:** hacer cada evento reproducible.

- [ ] IndexedDB con migraciones;
- [ ] manifest de sesión;
- [ ] event store normalizado;
- [ ] trajectories store;
- [ ] geometries store;
- [ ] annotations store separado;
- [ ] exportación CSV de resumen;
- [ ] exportación JSON/JSONL completa;
- [ ] hash de configuración;
- [ ] auditoría audiovisual opcional.

**Criterio de salida:** cualquier evento exportado puede rastrearse a sesión, track, modelo y geometría.

---

## Fase 6 — Interfaz de terreno / PWA

**Objetivo:** operación rápida, robusta y offline.

- [ ] instalación como PWA;
- [ ] pantalla principal de cámara;
- [ ] creación táctil de líneas y polígonos;
- [ ] selector de categorías visibles;
- [ ] panel de calidad (FPS, latencia, drops, backend);
- [ ] estado de almacenamiento;
- [ ] modo oscuro/alto contraste para terreno;
- [ ] exportación de sesión;
- [ ] importación de configuración;
- [ ] recuperación tras cierre accidental.

**Criterio de salida:** sesión completa realizable sin conexión y recuperable localmente.

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

**Criterio de salida:** métricas físicas se muestran solo cuando la calibración cumple umbral de calidad definido.

---

## Fase 8 — Validación científica

**Objetivo:** conocer el error, no ocultarlo.

- [ ] protocolo de ground truth;
- [ ] herramienta para anotación/revisión;
- [ ] corpus de escenas de movilidad;
- [ ] estratificación por modo, densidad y condición;
- [ ] precision/recall/F1;
- [ ] IDF1/HOTA o métricas equivalentes;
- [ ] error de conteo por clase y sentido;
- [ ] error de permanencia;
- [ ] error de velocidad cuando aplique;
- [ ] informe reproducible de validación.

**Criterio de salida:** versión candidata a levantamientos profesionales acompañada de un reporte de desempeño y limitaciones.

---

## Prioridad inmediata

El orden de desarrollo será:

**geometría → tracking → detector → fusión modal → almacenamiento → interfaz**.

La razón es metodológica: mejorar primero la interfaz o sustituir COCO-SSD por un detector más potente no corrige por sí solo los errores de identidad y de definición del evento que determinan el conteo final.
