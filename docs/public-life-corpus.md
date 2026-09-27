# Corpus Konta2r Public Life — protocolo v1

## Propósito

El corpus Public Life debe permitir medir error en **relaciones y episodios observables**, no sólo en detecciones.

La unidad científica no es “una imagen interesante”, sino una secuencia versionada con:

- video/medio identificado por hash;
- anotación identificada por hash;
- mapa semántico identificado por hash cuando corresponda;
- split congelado;
- sitio pseudonimizado;
- condiciones de observación;
- vocabulario y protocolo de anotación congelados.

La fuente de verdad del manifest está en:

`src/public-life/corpusManifest.ts`

## Splits

Se reutilizan:

- `development`;
- `validation`;
- `held_out_test`.

El mismo archivo de video o de anotación no puede aparecer en más de un split.

Idealmente, los sitios del held-out test tampoco aparecen en development/validation. El validador lo reporta como warning porque en algunos experimentos puede ser deliberado evaluar generalización temporal dentro del mismo lugar.

## Tipos de espacio iniciales

- plaza;
- park;
- sidewalk;
- pedestrian_street;
- transit_stop;
- commercial_frontage;
- school_frontage;
- cycleway_edge;
- shared_space;
- other.

Estas categorías describen contexto de muestreo, no calidad urbana.

## Estratos mínimos

Cada secuencia registra:

- iluminación;
- ángulo de cámara;
- densidad;
- oclusión;
- estabilidad de cámara;
- duración.

El corpus final debe evitar que un predicado esté representado únicamente en un solo escenario fácil.

## Ground truth

Métodos registrados:

- `single_annotator`;
- `independent_double`;
- `consensus`;
- `synthetic`.

Para el held-out test se prioriza doble anotación independiente o consenso.

El manifest emite warning cuando una secuencia held-out depende sólo de un anotador.

## Predicados objetivo

Cada secuencia declara `targetPredicateIds`.

Esto significa:

> estos predicados fueron buscados/anotados explícitamente en toda la secuencia.

No significa que todos tengan ejemplos positivos.

`positiveEpisodeCounts` permite detectar predicados nominalmente incluidos pero sin evidencia positiva.

## Episodios inciertos

La anotación debe permitir `uncertain`.

Una escena que un observador humano no puede clasificar con seguridad no se fuerza a positivo/negativo sólo para completar una matriz.

`uncertainEpisodeCount` deja trazabilidad del volumen de ambigüedad.

## Privacidad

El manifest no contiene:

- dirección postal;
- coordenadas precisas;
- rostro;
- nombre;
- matrícula;
- identificadores de personas;
- inferencias de atributos sensibles.

`siteId` debe ser un token pseudónimo.

Los IDs de sujetos dentro de anotaciones deben ser efímeros por secuencia.

## Mapa semántico

Cuando el análisis usa elementos estáticos —banco, árbol, borde, paradero, fachada— la secuencia referencia su `semanticMapSha256`.

Esto permite reproducir:

```text
persona t_12
  ↓
sitting_on
  ↓
bench_03
```

sin depender de que el mobiliario sea redetectado en cada frame.

## Diseño inicial del piloto

Antes de escalar volumen, construir un corpus pequeño pero deliberadamente adversarial.

### Persona–elemento

- sentado en banco;
- de pie junto a banco;
- pasando junto a banco;
- sentado en borde/murete;
- apoyado en borde/muro;
- proximidad sin uso.

### Persona–bicicleta

- riding;
- holding;
- caminando al lado;
- empujando;
- bicicleta estacionada próxima;
- transición montar/bajarse.

### Persona–persona

- talking_to;
- proximidad sin interacción;
- caminar juntos;
- cruzarse;
- sentarse juntos;
- grupos;
- oclusión.

## Criterio de avance

No comenzar un benchmark comparativo A/B/C/D hasta que el coverage report confirme al menos:

1. development + validation + held_out_test;
2. dos o más sitios pseudonimizados;
3. ejemplos positivos y negativos de los predicados prioritarios;
4. escenarios con oclusión;
5. held-out con revisión humana independiente;
6. vocabulario congelado por hash.

La cobertura del manifest **no declara validez científica**; sólo detecta huecos estructurales antes de gastar tiempo de inferencia.
