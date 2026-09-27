# Benchmark Public Life A/B/C/D

## Objetivo

Comparar las cuatro estrategias experimentales de Konta2r sobre el **mismo ground truth**:

- **A — geometry:** reglas geométricas/temporales;
- **B — relation provider:** evidencia del modelo relacional;
- **C — hybrid:** geometría + modelo relacional;
- **D — hybrid temporal:** híbrido + persistencia temporal.

La implementación base está en:

`src/public-life/benchmark.ts`

## Métricas por frame

Sólo se puntúan juicios humanos explícitos:

```text
positive
negative
```

Se excluyen de la matriz binaria:

```text
uncertain
not_observable
sin juicio
```

Esto evita una fuente crítica de sesgo:

> una relación no anotada no puede convertirse automáticamente en un falso positivo del modelo.

Las predicciones sin juicio humano compatible se reportan como:

`unscoredPredictions`

y deben revisarse al auditar cobertura del corpus.

## Predicados simétricos

Predicados definidos como simétricos en el vocabulario, por ejemplo `talking_to`, se normalizan:

```text
person_A talking_to person_B
=
person_B talking_to person_A
```

Esto evita castigar artificialmente el orden sujeto/objeto cuando metodológicamente no tiene dirección.

## Métricas de frame

Por predicado:

- TP;
- TN;
- FP;
- FN;
- precision;
- recall;
- specificity;
- F1;
- accuracy;
- juicios inciertos;
- juicios no observables;
- predicciones no puntuables.

Además:

- macro precision;
- macro recall;
- macro F1.

Los promedios macro sólo consideran predicados con al menos un juicio binario puntuable.

## Episodios

La anotación v1 contiene episodios positivos e inciertos, pero **no ventanas negativas exhaustivas de episodios**.

Por ello el benchmark de episodios reporta:

- episodios GT positivos;
- episodios GT inciertos;
- episodios positivos emparejados;
- episodios positivos omitidos;
- recall de episodios positivos;
- temporal IoU;
- MAE de inicio;
- MAE de fin;
- MAE de duración;
- fragmentación;
- predicciones no verificadas.

No se denomina “false positive episode” a una predicción no emparejada mientras no exista un protocolo de ventanas negativas temporales explícitas.

## Emparejamiento temporal

Dos episodios pueden emparejarse cuando:

1. tienen el mismo predicado;
2. corresponden al mismo par de endpoints, considerando simetría;
3. su temporal IoU supera el umbral configurado.

El matching es uno-a-uno y prioriza el mayor temporal IoU.

## Fragmentación

Si un episodio humano continuo es cubierto por múltiples episodios predichos, se registra `fragmentationExcess`.

Ejemplo:

```text
GT      ─────────────────────

modelo  ───────   ───────────
                    ↑
              fragmentación
```

Este indicador es especialmente importante para estudios Public Life: contar dos episodios de permanencia donde hubo uno altera tiempos de uso y frecuencias de actividad.

## Thresholds

Los thresholds son parte del resultado:

- score por defecto;
- score por predicado opcional;
- temporal IoU mínimo.

Deben congelarse antes del held-out test.

## Interpretación

El evaluador no declara por sí mismo qué variante A/B/C/D es “buena”.

Su función es producir evidencia comparable:

```text
mismo corpus
+ mismos splits
+ mismos juicios humanos
+ thresholds registrados
→ métricas comparables
```

La selección de una estrategia operacional deberá considerar además latencia, memoria, temperatura, energía, estabilidad y licencia.
