# Runtime experimental Public Life

## Propósito

Conectar las piezas ya implementadas de la línea Public Life sin convertirlas todavía en parte obligatoria del pipeline productivo.

Implementación:

`src/public-life/runtime.ts`

## Posición arquitectónica

El runtime se mantiene **al lado** de `MobilityFrameProcessor`:

```text
detector
  ↓
fusión modal
  ↓
tracking
  ↓
confirmed tracks
  ├──────────────→ movilidad
  │
  └──────────────→ PublicLifeRuntime
                    ↓
             semantic map
                    ↓
             candidate gate
                    ↓
             temporal sampling
                    ↓
             RelationProvider
                    ↓
             temporal persistence
                    ↓
             ActivityEpisode
```

Esto permite experimentar y benchmarkear relaciones sin hacer que la PWA dependa del relation model.

## Score semantics

El runtime distingue dos contratos de provider:

### dense

Todo par candidato/predicado solicitado recibe un score.

Si una relación activa no aparece en la salida de un provider `dense`, el runtime puede tratarla como score 0 explícito.

### thresholded_partial

El provider puede omitir pares o predicados debido a:

- threshold;
- top-K;
- final relation budget;
- selección interna del modelo.

En ese caso:

```text
ausencia de output
≠ score 0
```

La ausencia se registra como:

`pair_not_scored`

y sólo puede cerrar un episodio por timeout de falta de evidencia, no como evidencia negativa inmediata.

RelateAnything está declarado actualmente como `thresholded_partial`.

## Sampling

Si el sampling decide no ejecutar el modelo en un frame:

- no se crea un `RelationFrameState`;
- no se registra score 0;
- no se inicia timeout de falta de evidencia.

Por tanto:

```text
frame omitido por sampling
≠ relación ausente
```

## Fallos del provider

Si el provider falla:

- el sampling **no** se marca como completado;
- el par puede volver a intentarse;
- una relación activa seleccionada recibe `provider_unavailable`;
- el error se conserva en telemetría del frame.

Esto evita convertir una falla de WebGPU/ONNX/memoria en una conclusión semántica.

## Endpoints

### Tracks

Sólo entran tracks confirmados con bbox válida.

### Elementos estáticos

Se admiten:

- `image`;
- `normalized_image`;
- `local_ground` cuando existe proyección explícita a imagen.

Un elemento `local_ground` sin transformador no se inventa ni se aproxima: se omite y se cuenta en `skippedStaticElementCount`.

## IDs

El runtime exige IDs únicos entre tracks y elementos estáticos dentro de una sesión.

Esto evita ambigüedad al reconstruir pares sujeto–objeto.

## Vocabulario por elemento

Un elemento del mapa semántico puede restringir su `relationVocabulary`.

Ejemplo:

```text
bench_01:
  sitting on
  standing beside
```

Si el relation model devuelve `talking to` contra ese banco, la observación se descarta antes de persistencia temporal.

## Salida

Cada frame experimental devuelve:

- cantidad de endpoints;
- cantidad de candidatos;
- plan de sampling;
- observaciones del provider;
- estados de evaluabilidad;
- relaciones activas;
- episodios completados;
- estado/latencia del provider;
- error del provider cuando existe.

## Estado

Este runtime es infraestructura experimental.

Todavía faltan antes de adopción operacional:

1. runtime smoke real de RelateAnything;
2. corpus Public Life poblado;
3. benchmark A/B/C/D;
4. calibración de thresholds;
5. evaluación de latencia/memoria/temperatura;
6. revisión de licencia de pesos;
7. decisión explícita sobre qué predicados se validan para cada contexto.
