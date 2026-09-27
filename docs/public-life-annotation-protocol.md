# Protocolo de anotación Public Life — ground truth v1

## Objetivo

El ground truth Public Life debe permitir comparar observación humana e inferencia automática sin convertir **ausencia de anotación** en una relación negativa.

La fuente de verdad del esquema está en:

`src/public-life/groundTruth.ts`

## Dos escalas de anotación

### Frames

Los frames muestreados registran:

- endpoints observados;
- bounding boxes cuando el endpoint es observable;
- nivel de visibilidad;
- juicios explícitos por relación.

Cada juicio puede ser:

- `positive`;
- `negative`;
- `uncertain`;
- `not_observable`.

Por tanto:

```text
sin juicio
≠ negative
```

### Episodios

Los episodios registran intervalos temporales:

```text
subject
predicate
object
startMs
endMs
positive | uncertain
```

No se crean “episodios negativos”. La ausencia de una actividad a lo largo de minutos debe evaluarse mediante los frames/intervalos explícitamente observados, no suponerse desde el silencio del anotador.

## Endpoints

Hay dos tipos:

### tracked_entity

IDs efímeros de la secuencia:

- persona;
- bicicleta;
- motocicleta;
- skateboard;
- otro objeto de movilidad.

No contienen nombre, cara, matrícula ni identidad persistente.

### semantic_element

Referencia a un elemento del `SemanticPublicSpaceMap`:

- banco;
- borde;
- árbol;
- paradero;
- escalera;
- fachada;
- etc.

## Oclusión

Un endpoint puede estar:

- visible;
- parcialmente ocluido;
- fuertemente ocluido;
- no observable.

Si uno de los endpoints no es observable, un juicio de relación sólo puede ser `not_observable`.

Esto permite evaluar correctamente la diferencia entre:

```text
modelo dio score bajo
```

y

```text
no existía evidencia visual suficiente para evaluar
```

## Incertidumbre humana

`uncertain` es una salida válida y necesaria.

Si el observador no puede decidir si dos personas conversan, o si una persona está usando un borde o sólo próxima a él, no debe forzarse una clase binaria para mejorar artificialmente la completitud del corpus.

## Predicados objetivo

Cada secuencia congela `targetPredicateIds`.

Sólo esos predicados pueden anotarse. Esto evita expandir silenciosamente el experimento después de mirar resultados.

Ejemplo inicial:

```text
sitting_on
leaning_against
talking_to
riding
holding
walking_beside
```

## Positivos y negativos

Para calcular precision/recall/F1 se necesitan ambos.

El resumen de ground truth reporta por predicado:

- positivos;
- negativos;
- inciertos;
- no observables;
- duración de episodios positivos;
- predicados sin positivos;
- predicados sin negativos;
- predicados sin juicios.

Un predicado sin negativos explícitos no tiene un benchmark de falsos positivos defendible.

## Relación con el corpus manifest

`docs/public-life-corpus.md` define qué secuencias pertenecen a cada split.

Este protocolo define el contenido de la anotación de cada secuencia.

La cadena reproducible es:

```text
PublicLifeCorpusManifest
        ↓ annotationSha256
PublicLifeGroundTruthSequence
        ↓
frames + juicios + episodios
        ↓
benchmark
```

## Regla de privacidad

Los IDs son locales a la secuencia.

No se permite:

- reconocimiento facial;
- reidentificación entre cámaras;
- nombre de persona;
- matrícula;
- atributos sensibles;
- inferencias psicológicas.

El objetivo es medir uso colectivo del espacio público, no identificar individuos.
