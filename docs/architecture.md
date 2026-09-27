# Arquitectura de Konta2r v2

## 1. Problema que resuelve

Konta2r no debe entenderse como un detector de objetos, sino como un **instrumento de medición de movilidad y vida pública basado en video**.

Una detección aislada (`person`, `bicycle`, `car`) no constituye todavía una observación de movilidad ni de vida pública. El sistema debe reconstruir entidades persistentes, interpretar relaciones observables entre entidades y elementos del lugar, aplicar reglas espaciales y generar eventos/episodios trazables.

## 2. Flujo de procesamiento

```text
Fuente de video
    ↓
Preprocesamiento
    ↓
Detector de objetos
    ↓
Normalización / asociación modal
    ↓
Multi-object tracker
    ↓
Entidades y trayectorias persistentes
    ├─────────────────────────────┐
    ↓                             ↓
MOVILIDAD                    VIDA PÚBLICA
motor espacial               relation candidates
├── cruces                   ├── persona–persona
├── zonas                    ├── persona–objeto
├── sentidos                 └── persona–elemento urbano
└── métricas calibradas             ↓
    ↓                         RelationProvider opcional
Eventos de movilidad                 ↓
                              persistencia relacional
                                     ↓
                              episodios de actividad
    └───────────────┬─────────────────┘
                    ↓
          Persistencia + auditoría
             + validación + exportación
```

La interfaz de usuario consume el estado del sistema, pero no define la lógica de medición.

## 3. Componentes

### 3.1 `capture`

Responsable de cámara, video cargado, resolución, orientación, timestamps y sincronización.

Debe entregar frames acompañados por metadata temporal. El tiempo de observación no puede inferirse del número de inferencias porque la velocidad de procesamiento puede variar.

### 3.2 `inference`

Interfaz común para ejecutar distintos modelos.

```ts
interface Detector {
  metadata(): DetectorMetadata;
  detect(frame: VideoFrameLike): Promise<RawDetection[]>;
  dispose(): Promise<void>;
}
```

Runtime inicial propuesto: **ONNX Runtime Web**.

- WebGPU cuando exista soporte adecuado.
- WASM como fallback.
- El modelo no forma parte del núcleo y debe poder sustituirse.

### 3.3 `domain/mobility`

Convierte detecciones visuales en entidades relevantes para movilidad.

Ejemplo central:

```text
person + bicycle ≠ pedestrian + bicycle
person + bicycle → cyclist
```

La asociación se realizará usando geometría, persistencia temporal y compatibilidad semántica. Esto evita dobles conteos y permite incorporar nuevas categorías sin reescribir el tracker.

### 3.4 `tracking`

Mantiene identidad temporal.

Requisitos mínimos:

- ID persistente;
- predicción de movimiento;
- asociación global entre detecciones y tracks;
- tolerancia a detecciones de baja confianza;
- manejo explícito de tracks tentativos, confirmados, perdidos y eliminados;
- historial de posición y score;
- métricas de calidad del track.

La primera implementación deberá aproximarse a ByteTrack/SORT moderno en vez del emparejamiento greedy por distancia usado en el prototipo.

### 3.5 `geometry`

Biblioteca independiente y testeable.

Debe resolver, al menos:

- intersección segmento–segmento;
- distancia perpendicular normalizada;
- proyección sobre segmentos;
- polígonos y zonas;
- homografía imagen ↔ plano de suelo cuando exista calibración;
- transformación entre coordenadas de video, canvas y coordenadas normalizadas.

**Regla:** un cruce se registra cuando la trayectoria intercepta el segmento de conteo; cambiar de lado de la recta infinita no basta.

### 3.6 `spatial-events`

Consume trayectorias y geometrías configuradas.

Tipos de eventos previstos:

- `line_crossing`;
- `zone_enter`;
- `zone_exit`;
- `dwell_completed`;
- `track_started`;
- `track_ended`;
- `speed_sample`;
- `trajectory_sample`.

### 3.7 `public-life / relations`

Esta capa modela relaciones observables y episodios de actividad sin acoplar el núcleo a un modelo concreto.

Contrato previsto:

```ts
interface RelationProvider {
  metadata(): RelationProviderMetadata;
  score(input: RelationInput): Promise<RelationObservation[]>;
  dispose(): Promise<void>;
}
```

Los candidatos de relación se generan desde tracks, proximidad espacial y un mapa semántico versionado del lugar. Un proveedor pesado puede invocarse sólo cuando exista ambigüedad o valor analítico suficiente.

**RelateAnything** se evaluará como primer candidato porque acepta regiones externas y un vocabulario abierto de predicados y dispone de un camino ONNX/browser. No se convierte por ello en dependencia obligatoria ni se asume que sus predicados son válidos para estudios Public Life sin benchmark específico.

El sistema debe mantener separados:

- observación: `sitting_on(bench_01)`, `talking_to(person)`, `riding(bicycle)`;
- persistencia temporal de esa observación;
- episodio derivado;
- interpretación urbanística posterior.

La especificación metodológica está en `docs/public-life-gehl.md`.

### 3.8 `storage`

Persistencia local con esquema versionado.

Inicialmente se utilizará IndexedDB, pero detrás de un repositorio abstracto. Esto permitirá incorporar posteriormente sincronización con backend sin modificar el motor de medición.

### 3.9 `validation`

La validación es un componente del producto, no una actividad externa.

Debe permitir comparar observaciones automáticas y ground truth para calcular por clase y condición:

- precision;
- recall;
- F1;
- MAE/MAPE de conteos cuando corresponda;
- error direccional;
- ID switches;
- fragmentación de tracks;
- error de permanencia;
- precision/recall/F1 por relación Public Life;
- error de duración y fragmentación de episodios de actividad;
- error de velocidad, si existe calibración.

## 4. Modelo de datos

Cada evento debe incluir como mínimo:

```text
event_id
session_id
track_id
entity_type
model_class(es)
timestamp
geometry_id
event_type
direction
confidence
position
model_id
model_version
runtime
runtime_version
tracker_id
tracker_version
configuration_hash
```

Un CSV resumido puede omitir columnas, pero el almacenamiento interno debe conservar auditabilidad.

## 5. Privacidad

La arquitectura privilegiará inferencia local.

Por defecto:

- no se guardan rostros;
- no se realiza reconocimiento facial;
- no se realiza lectura de matrículas;
- el video no necesita salir del dispositivo;
- el almacenamiento de video es una opción explícita de auditoría, no un requisito del conteo.

## 6. Estructura prevista

```text
src/
  capture/
  inference/
  domain/
  tracking/
  geometry/
  relations/
  public-life/
  spatial-events/
  storage/
  validation/
  ui/
  config/
tests/
docs/
models/
```

Los modelos pesados no deberán versionarse directamente en Git salvo decisión explícita; se documentará origen, hash, licencia y procedimiento reproducible de obtención/exportación.

## 7. Criterio de diseño

Konta2r considerará una observación auditable sólo si puede reconstruir qué entidad fue observada, dónde y cuándo, qué trayectoria/relación produjo el evento o episodio, qué regla o modelo lo generó y con qué configuración se produjo.

Para vida pública se agrega una regla epistemológica: **la observación visual y la interpretación urbanística deben almacenarse como niveles distintos**. Si una afirmación no puede reconstruirse hasta la evidencia observable que la sustenta, puede ser una interpretación útil, pero no un dato automático científicamente auditable.
