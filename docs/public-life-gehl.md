# Konta2r Public Life — observación de vida pública inspirada en Gehl

## Propósito

Konta2r no debe limitarse a contar desplazamientos. Su alcance incluye observar de forma reproducible **cómo las personas ocupan, usan y comparten el espacio público**.

Esta línea se inspira en la tradición de **Public Space / Public Life (PSPL)** asociada a Jan Gehl y desarrollada posteriormente por Gehl y otros equipos de investigación urbana. La referencia metodológica no implica automatizar interpretaciones humanas indiscriminadamente: Konta2r debe separar con claridad lo que la cámara **observa** de lo que un analista **interpreta**.

Fuentes de referencia iniciales:

- Gehl, *Social Spatial Research*: https://www.gehlpeople.com/services/social-spatial-research/
- Gehl, *Urban95 Public Life Data Framework*: https://www.gehlpeople.com/knowledge-hub/publications/urban95-public-life-data-framework/
- Gehl, *Measuring What We Care About*: https://www.gehlpeople.com/knowledge-hub/articles/measuring-what-we-care-about-harnessing-digital-tools-for-deeper-urban-insights/
- Gehl & Svarre, *How to Study Public Life* (Island Press, 2013).
- RelateAnything: https://github.com/Maelic/RelateAnything
- Neau, M. (2026), *RelateAnything: Real-Time Open-Vocabulary Relation Prediction From Any Inputs*, arXiv:2609.12552.

## 1. Cambio de foco

El pipeline histórico responde bien a preguntas de movilidad:

- cuántas entidades pasan;
- por dónde pasan;
- en qué sentido;
- cuánto tarda una trayectoria;
- qué modo de movilidad representa cada entidad.

La línea Public Life incorpora preguntas adicionales:

1. **cuántos** usuarios están presentes o permanecen;
2. **quiénes**, entendido como categorías observables y metodológicamente autorizadas, no identidad personal;
3. **dónde** se localizan, se concentran o permanecen;
4. **qué hacen**, limitado a comportamientos visualmente observables;
5. **con quién o con qué** se relacionan;
6. **durante cuánto tiempo** persisten actividad, relación y permanencia.

Esto permite estudiar no sólo flujo, sino también **permanencia, actividad estacionaria, interacción y relación entre personas y elementos del espacio público**.

## 2. Tres niveles de dato

### 2.1 Entidad observable

Ejemplos:

- pedestrian;
- cyclist;
- motorcyclist;
- car;
- bus;
- truck.

La entidad mantiene una trayectoria temporal mediante tracking.

### 2.2 Relación observable

Una relación conecta dos regiones/entidades o una entidad y un elemento estático del lugar.

Ejemplos:

- `person --sitting_on--> bench`;
- `person --leaning_against--> wall`;
- `person --standing_beside--> tree`;
- `person --talking_to--> person`;
- `person --walking_with--> person`;
- `person --riding--> bicycle`;
- `person --holding--> bicycle`.

La relación debe incluir score, modelo/proveedor, timestamps y evidencia de persistencia.

### 2.3 Episodio analítico

Un episodio agrega observaciones en el tiempo:

```text
track/persona
    +
zona espacial
    +
relación observable
    +
duración
    ↓
episodio de actividad
```

Ejemplo:

```text
persona
zona = plaza_01
relación = sitting_on(bench_03)
duración = 11 min
acompañamiento = 2 tracks próximos
```

Esto puede clasificarse posteriormente como **actividad estacionaria sentada** y, si existe evidencia relacional suficiente, como **actividad social probable**.

La inferencia analítica debe conservar siempre los datos observados que la sustentan.

## 3. Observación ≠ interpretación

Konta2r no debe afirmar automáticamente estados internos, motivaciones o categorías que la imagen no demuestra.

Ejemplos:

| Observación aceptable | Interpretación que requiere reglas/evidencia adicional |
|---|---|
| sentado en banco | descansando |
| de pie 8 minutos | esperando |
| dos personas con relación `talking_to` persistente | actividad social |
| caminando con bicicleta | viaje activo / paseo |
| mirando una vitrina | interés comercial |
| permanencia bajo un árbol | búsqueda de sombra |

Las categorías interpretativas pueden existir, pero deberán:

1. estar documentadas como reglas derivadas;
2. conservar la observación original;
3. tener confidence o nivel de evidencia propio;
4. validarse contra codificación humana independiente.

## 4. Mapa semántico del espacio público

Los elementos urbanos son mayoritariamente estáticos. No es necesario detectarlos de nuevo en cada frame.

Konta2r podrá mantener un **Semantic Public Space Map** versionado con elementos como:

```text
bench_01
bench_02
tree_01
planter_edge_01
wall_edge_01
stairs_01
bus_stop_01
shopfront_01
play_area_01
cycle_parking_01
```

Cada elemento deberá poder vincularse a:

- geometría en imagen;
- geometría en plano calibrado, cuando exista;
- tipo de elemento;
- capacidad/atributos observables cuando corresponda;
- revisión/versionado de la configuración.

Esto permite analizar relaciones persona–espacio con un costo computacional menor que redetectar continuamente la infraestructura.

## 5. RelationProvider

La arquitectura incorporará una interfaz desacoplada del modelo concreto:

```ts
interface RelationProvider {
  metadata(): RelationProviderMetadata;
  score(input: RelationInput): Promise<RelationObservation[]>;
  dispose(): Promise<void>;
}
```

El núcleo no dependerá de RelateAnything ni de una familia específica.

### 5.1 RelateAnything como candidato

RelateAnything es especialmente pertinente porque:

- recibe una imagen y regiones externas;
- no sustituye al detector;
- permite vocabulario abierto de relaciones;
- dispone de despliegue ONNX y browser WebGPU/WASM;
- separa código Apache-2.0 de las condiciones de sus pesos derivados de DINOv3.

Se evaluará como **candidato experimental**, no como dependencia obligatoria.

### 5.2 Ejecución condicional

El modelo relacional no debe necesariamente ejecutarse en todos los frames.

Estrategia inicial:

```text
detección
  ↓
tracking
  ↓
candidate relation gate
  ├── caso geométricamente claro → regla ligera
  └── caso ambiguo/relevante      → RelationProvider
                                      ↓
                               evidencia semántica
```

Perfiles tentativos:

- `eco`: reglas espaciales/temporales sin relation model pesado;
- `balanced`: relation model sólo ante candidatos ambiguos y con sampling temporal;
- `performance`: relaciones con mayor frecuencia cuando hardware y estabilidad térmica lo permitan.

Los perfiles son hipótesis de benchmark, no una decisión de producto cerrada.

## 6. Vocabulario Public Life inicial

El registro versionado del vocabulario y sus límites de interpretación está en `docs/public-life-vocabulary.md` y `src/public-life/vocabulary.ts`.

El vocabulario debe privilegiar acciones/relaciones observables.

### Persona–elemento urbano

- `sitting on`
- `leaning against`
- `standing beside`
- `standing under`
- `looking at`
- `using`

### Persona–persona

- `talking to`
- `walking with`
- `standing beside`
- `sitting with`
- `looking at`

### Persona–objeto / movilidad

- `riding`
- `holding`
- `carrying`
- `pushing`
- `walking beside`

Cada predicado deberá pasar por un protocolo de validación específico. La posibilidad técnica de escribir cualquier frase no demuestra que el modelo pueda medirla con precisión suficiente.

## 7. Persistencia temporal de relaciones

Una relación por frame no equivale a una actividad.

El sistema deberá distinguir:

- score bajo observado;
- relación no evaluable porque desapareció uno de los endpoints;
- oclusión breve;
- fin real de la relación.

Se evaluará un estado temporal de relaciones —por ejemplo filtro probabilístico/Kalman sobre scores o log-odds— separado del tracker de objetos.

Objetivo:

```text
riding → riding → endpoint ocluido → riding
```

no debe convertirse automáticamente en:

```text
cyclist → pedestrian → cyclist
```

ni generar episodios de actividad artificialmente fragmentados.

## 8. Productos Public Life

Los productos derivados podrán incluir:

### Movimiento

- flujos por modo;
- trayectorias;
- cruces;
- origen/destino interno cuando la geometría lo permita.

### Permanencia

- personas presentes;
- tasa de permanencia;
- duración p50/p95;
- permanencia por zona;
- ocupación temporal.

### Actividad observable

- sentado;
- de pie;
- caminando;
- usando un elemento;
- interacción probable;
- actividad asociada a objetos/infraestructura.

### Relación persona–espacio

- uso de bancos;
- uso de bordes/muretes;
- proximidad/uso de sombra;
- uso de áreas de juego;
- interacción con fachadas o equipamiento;
- distribución espacial de actividades.

### Relaciones sociales

Sólo con evidencia validada y agregada:

- agrupaciones;
- interacción probable;
- duración de interacción;
- tamaño de grupos.

No se pretende identificar personas ni mantener identidad entre cámaras.

## 9. Indicadores candidatos

Los siguientes indicadores son **definiciones de trabajo** y requieren validación.

### Tasa de permanencia

```text
personas que permanecen sobre un umbral validado
------------------------------------------------
personas que ingresan al área de estudio
```

### Tiempo-persona de permanencia

Suma de los tiempos observados de tracks confirmados dentro de una zona, con reglas explícitas para oclusiones y pérdidas.

### Uso de mobiliario

Tiempo-persona vinculado mediante una relación validada a un elemento del mapa semántico.

### Actividad social probable

Tiempo-persona asociado a relaciones sociales visualmente observables y temporalmente persistentes.

No debe denominarse “sociabilidad” ni “calidad del espacio público” sin una definición analítica adicional y evidencia independiente.

## 10. Privacidad

La rama Public Life mantiene los principios privacy-first de Konta2r.

Por defecto:

- no reconocimiento facial;
- no lectura de matrículas;
- no embeddings de reidentificación entre cámaras;
- IDs efímeros por sesión/nodo;
- no inferir identidad personal;
- no inferir estados mentales;
- no inferir atributos sensibles;
- Community publica agregados, no relaciones individuo-a-individuo persistentes.

El modo profesional puede conservar evidencia audiovisual únicamente cuando el protocolo de investigación lo autorice explícitamente.

## 11. Programa experimental

El protocolo operativo del experimento se documenta en `docs/experiments/relateanything-public-life.md`.

El primer benchmark deberá comparar:

```text
A  reglas geométricas
B  RelationProvider
C  geometría + RelationProvider
D  geometría + RelationProvider + persistencia temporal
```

Ground truth humano mínimo:

- persona caminando;
- persona sentada;
- persona de pie;
- ciclista montado;
- persona caminando con bicicleta;
- persona usando banco/borde;
- persona próxima a mobiliario sin usarlo;
- pares conversando/interactuando;
- pares próximos sin interacción;
- oclusiones y grupos.

Métricas:

- precision/recall/F1 por relación;
- matriz de confusión de actividades observables;
- duración/error de episodios;
- fragmentación temporal;
- falsos usos de mobiliario;
- falsos grupos/interacciones;
- impacto final sobre indicadores agregados.

## 12. Principio metodológico

El objetivo no es que una IA “explique” lo que hacen las personas.

El objetivo es construir una cadena auditable:

```text
pixels
  ↓
entidades
  ↓
posición y trayectoria
  ↓
relaciones observables
  ↓
persistencia
  ↓
episodios
  ↓
agregados
  ↓
interpretación urbanística explícita
```

Así Konta2r puede ampliar la observación de movilidad hacia vida pública sin confundir detección automática con interpretación social.
