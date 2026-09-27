# Public Life en Konta2r Community

## Objetivo

Publicar indicadores agregados de vida pública sin transportar las unidades individuales que los originan.

La cadena es:

```text
ActivityEpisode local
      ↓
clasificación gruesa
      ↓
bucket temporal
      ↓
supresión por bajo N
      ↓
CommunityUploadEnvelope
```

Nunca se publican:

- track IDs;
- episode IDs;
- IDs exactos de bancos, árboles u otros elementos;
- subject/object IDs;
- imágenes o video;
- coordenadas residenciales precisas;
- identidad personal.

## Agregado público

El tipo `public_life` contiene:

- `bucketStartMs`;
- `bucketEndMs`;
- `activityClass`;
- `elementClass`;
- `uniqueEntities`;
- `episodeCount`;
- `totalDurationSeconds`;
- `participantTimeSeconds`;
- `meanQuality`.

### activityClass

Categorías deliberadamente gruesas:

- `seated_use`;
- `supported_stay`;
- `social_interaction`;
- `mobility_relation`;
- `spatial_context`;
- `other_observed_relation`.

No se publican predicados arbitrarios del modelo como vocabulario abierto.

### elementClass

El mobiliario o elemento urbano se reduce a:

- `none`;
- `seating`;
- `edge_support`;
- `greenery`;
- `transit`;
- `stairs`;
- `frontage`;
- `play`;
- `cycle_parking`;
- `other`;
- `mixed`.

Por ejemplo:

```text
bench_03
bench_04
bench_09
   ↓
seating
```

El identificador exacto sólo existe localmente.

## Pisos de privacidad

Un registro Public Life sólo puede salir de un nodo si cumple simultáneamente:

```text
uniqueEntities >= 3
episodeCount   >= 3
bucket         >= 60 s
```

El agregador cliente no permite bajar estos pisos mediante configuración.

El protocolo de ingreso vuelve a validarlos.

La base PostgreSQL los aplica por constraints.

Por tanto existen tres fronteras independientes:

```text
agregador local
    ↓
validator/parser de ingreso
    ↓
constraint PostgreSQL
```

## Tiempo agregado

`totalDurationSeconds` suma la duración de los episodios.

`participantTimeSeconds` pondera además la cantidad de participantes.

Ejemplo:

Tres episodios de conversación de 60 s entre dos personas cada uno:

```text
totalDurationSeconds       = 180
participantTimeSeconds     = 360
```

Esto permite distinguir duración de episodios y exposición/participación total sin publicar los pares individuales.

## Cuantización

El agregador redondea por defecto los tiempos a múltiplos de 10 s.

Esto evita transportar precisión temporal innecesaria y reduce el riesgo de reconstrucción de eventos individuales.

El valor es configurable para experimentos, pero no elimina los pisos estructurales de privacidad.

## Supresión

Si un grupo no alcanza los mínimos:

- no se publica;
- se incrementan contadores locales de supresión;
- los IDs que permitieron calcular el grupo no salen del dispositivo.

Los contadores de supresión sirven para diagnosticar cuánta información se pierde por privacidad, no para reconstruir eventos.

## Persistencia

Los registros aceptados se almacenan en:

`private.public_life_aggregates`

La tabla permanece fuera de los schemas expuestos a navegador y comparte el mismo `batch_id` de Community que flujo y agregados espaciales.

## Relación con Gehl / Public Life

Estos agregados permiten construir posteriormente indicadores como:

- tiempo agregado de uso sentado;
- permanencia apoyada;
- interacción social probable;
- tiempo asociado a mobiliario de asiento;
- tiempo asociado a bordes/muretes;
- relaciones de movilidad observables.

No deben traducirse automáticamente a:

- satisfacción;
- confort;
- amistad;
- intención;
- calidad urbana global.

La interpretación urbanística sigue siendo una capa posterior y explícita.
