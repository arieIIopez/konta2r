# Sampling temporal de relaciones Public Life

## Propósito

Los modelos de relaciones son sustancialmente más costosos que el candidate gate geométrico. Konta2r no necesita evaluar el mismo par en todos los frames para estudiar actividades que duran segundos o minutos.

El scheduler implementado en `src/relations/samplingGate.ts` decide **cuándo volver a consultar semánticamente un par**.

No decide si la relación existe.

## Separación de responsabilidades

```text
candidate gate espacial
  ↓
pares plausibles
  ↓
sampling gate temporal
  ↓
pares que ameritan nueva inferencia
  ↓
RelationProvider
  ↓
RelationTemporalPersistence
```

La geometría reduce el universo de pares. El sampling reduce la frecuencia. El provider aporta evidencia semántica. La persistencia transforma observaciones en episodios.

## Reglas de reevaluación

Un par es elegible cuando ocurre al menos una condición:

1. nunca fue evaluado;
2. pasó el intervalo mínimo;
3. cambió materialmente la geometría de alguno de los endpoints;
4. cambió materialmente la prioridad del candidate gate.

Además se aplica un presupuesto máximo de pares por inferencia.

## Regla ante fallo

`plan()` no marca automáticamente un par como evaluado.

Sólo después de que el provider completa debe llamarse `recordEvaluation(...)`.

Si ONNX falla, se agota memoria o el navegador pierde WebGPU, el par puede volver a intentarse. Un fallo computacional nunca se registra como evidencia semántica negativa.

## Perfiles iniciales

Se definen valores **experimentales, no validados**:

| perfil | intervalo | pares por evaluación |
|---|---:|---:|
| eco | 2000 ms | 4 |
| balanced | 1000 ms | 8 |
| performance | 500 ms | 16 |

También varían los umbrales de cambio geométrico y de prioridad.

Estos números son puntos de partida para benchmark. Deben modificarse si la evidencia muestra otra frontera entre costo y error de episodios.

## Qué medir

Para cada configuración registrar:

- inferencias relacionales por minuto;
- pares candidatos por frame;
- pares seleccionados;
- pares diferidos por presupuesto;
- latencia;
- memoria;
- duración/error de episodios;
- relaciones perdidas durante transiciones rápidas.

El objetivo no es minimizar llamadas al modelo por sí mismo, sino encontrar la menor frecuencia que conserve la calidad de los indicadores Public Life.
