# Vocabulario Konta2r Public Life

## Estado

**Vocabulario inicial para benchmark. No constituye una taxonomía validada.**

La función de este documento es congelar una primera lista de relaciones observables para el programa Public Life y evitar que los prompts/predicados cambien silenciosamente entre experimentos.

La fuente de verdad ejecutable está en:

`src/public-life/vocabulary.ts`

## Principio

Un predicado debe describir algo que pueda ser contrastado con observación humana.

No se incluyen como salidas automáticas iniciales categorías como:

- actividad necesaria;
- actividad opcional;
- actividad social;
- descansando;
- esperando;
- disfrutando;
- inseguro;
- interesado.

Esas expresiones pueden ser categorías analíticas posteriores, pero no equivalen directamente a una relación visual.

## Predicados incluidos en el vocabulario publicado de RelateAnything

El repositorio de RelateAnything publica un vocabulario por defecto que incluye, entre otros:

- `riding`;
- `sitting on`;
- `holding`;
- `looking at`;
- `using`;
- `carrying`;
- `talking to`;
- `standing beside`;
- `walking past`;
- `leaning against`;
- `beside`;
- `in front of`.

Que estén presentes en el vocabulario publicado **no significa que estén validados para cámaras urbanas de Konta2r**. En el registro se marcan como `benchmark_candidate`.

Fuente:

https://github.com/Maelic/RelateAnything/blob/main/relsgg/vocabulary.py

## Predicados experimentales abiertos

RelateAnything permite vocabulario abierto. Konta2r incorpora inicialmente como hipótesis:

- `walking with`;
- `sitting with`;
- `pushing`;
- `walking beside`.

Estos predicados se marcan como `experimental_custom / unvalidated`.

Su sola codificación textual no es evidencia de que el modelo pueda estimarlos adecuadamente.

## Categorías

### Persona–elemento

Orientadas a uso/relación con espacio y mobiliario:

- sitting on;
- leaning against;
- standing beside;
- using;
- looking at.

### Persona–persona

Orientadas a interacción observable:

- talking to;
- walking with;
- sitting with.

### Persona–movilidad

Orientadas a resolver comportamiento modal:

- riding;
- holding;
- carrying;
- pushing;
- walking beside.

### Contexto espacial

Apoyo geométrico/semántico, no interacción:

- walking past;
- beside;
- in front of.

## Regla de interpretación

Ejemplo:

```text
sitting on + bench_01 + 11 min
```

es evidencia de un episodio de uso sentado del banco.

No prueba por sí solo:

```text
descanso
confort
satisfacción
actividad opcional
```

La interpretación urbanística debe ocurrir en una capa posterior y conservar trazabilidad hacia las observaciones.

## Criterio para promover un predicado

Un predicado sólo puede pasar a `validated` cuando exista un benchmark reproducible que especifique:

- corpus/split;
- definición de ground truth;
- acuerdo o procedimiento de anotación;
- threshold;
- precision/recall/F1;
- desempeño por condiciones;
- error temporal si forma episodios;
- impacto sobre el indicador agregado;
- dispositivo/runtime cuando corresponda.

Un predicado puede ser rechazado aunque visualmente produzca ejemplos convincentes si no reduce el error del producto final.
