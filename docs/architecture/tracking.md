# Tracking multiobjeto en Konta2r v2

## Propósito

El tracker preserva una identidad **temporal y local** mientras una entidad de movilidad permanece en la escena. Esa identidad existe para evitar dobles conteos, reconstruir trayectorias y medir permanencias. No representa identidad civil, biométrica ni persistente y no debe vincularse entre nodos.

## Problema del baseline

El prototipo `contador.html` asociaba detecciones mediante reglas greedy basadas en distancia/IoU. En escenas con dos objetos de la misma clase, cruces, grupos u oclusiones, el resultado depende del orden local de asociación y puede producir:

- cambios de identidad;
- fragmentación de una trayectoria;
- recuperación como un track nuevo;
- dobles conteos;
- permanencias artificialmente cortas;
- velocidades discontinuas.

## Arquitectura v2

```text
detecciones modales
      ↓
predicción de movimiento
      ↓
matriz de costos
      ↓
asignación global Hungarian
      ↓
┌──────────────────────────┐
│ etapa 1: alta confianza │
└────────────┬─────────────┘
             ↓
tracks no asociados
             +
detecciones baja confianza
             ↓
┌──────────────────────────┐
│ etapa 2: recuperación    │
└────────────┬─────────────┘
             ↓
actualizar / lost / crear / remover
```

La segunda etapa está inspirada en la idea central de ByteTrack: una detección de baja confianza puede seguir siendo útil para conservar una trayectoria existente bajo oclusión parcial. En Konta2r, las detecciones de baja confianza **no crean tracks nuevos**.

## Estados

- `tentative`: track recién creado que todavía no acumula evidencia suficiente;
- `confirmed`: identidad temporal aceptada para producir eventos;
- `lost`: track confirmado momentáneamente no observado, conservado durante una ventana de recuperación;
- `removed`: track terminado que ya no participa en asociaciones.

Los eventos de movilidad deberían producirse preferentemente desde tracks `confirmed`.

## Modelo de movimiento actual

La primera implementación usa velocidad constante en coordenadas de imagen:

`p(t + Δt) = p(t) + v(t)·Δt`

La primera velocidad observada se inicializa directamente desde el primer desplazamiento medido. A partir de las observaciones siguientes se aplica suavizado exponencial.

Esta decisión se incorporó después de que un benchmark sintético revelara que suavizar la primera velocidad contra cero subestimaba el movimiento y causaba cambios de identidad durante un cruce.

El modelo actual no se presenta como un filtro de Kalman completo. Si los benchmarks reales lo justifican, el estado puede evolucionar posteriormente a un estimador probabilístico sin cambiar el contrato externo del tracker.

## Asignación global

Se implementó Hungarian para minimizar conjuntamente el costo de asociación. Esto evita que una decisión greedy temprana consuma una detección que corresponde mejor a otro track.

Las asociaciones incompatibles reciben costo infinito.

## Costo de asociación inicial

El costo combina:

- distancia a la posición predicha;
- IoU respecto de la caja predicha;
- coherencia de dirección;
- similitud aproximada de tamaño.

Las ponderaciones actuales son parámetros iniciales y deberán calibrarse con datos reales. No deben interpretarse como valores científicos definitivos.

## Recuperación tras oclusión

Un track confirmado puede pasar a `lost` y seguir siendo candidato durante `maxLostMs`. Los tracks `lost` utilizan una compuerta espacial algo mayor para reflejar incertidumbre acumulada.

Una detección compatible recupera el mismo ID y retorna el track a `confirmed`.

## Métrica de calidad del track

El tracker calcula un score compuesto inicial utilizando:

- confianza de la observación reciente;
- continuidad hits/(hits+misses);
- madurez del track;
- estado actual.

Este score sirve como señal de control para capas posteriores. Debe validarse/calibrarse antes de ser interpretado como probabilidad.

## Métricas de evaluación

Konta2r incorpora evaluación explícita de identidad:

- ID precision;
- ID recall;
- IDF1;
- ID switches;
- fragmentaciones;
- cantidad de objetos GT únicos;
- cantidad de tracks predichos únicos;
- error de conteo por identidades únicas.

La evaluación espacial GT↔predicción se mantendrá separada de las métricas de identidad para que el umbral espacial sea explícito y reproducible.

## Benchmark sintético actual

Existen pruebas determinísticas para:

1. maduración `tentative → confirmed`;
2. cruce de dos objetos de la misma categoría;
3. oclusión representada por una detección de baja confianza;
4. pérdida temporal y recuperación;
5. eliminación por timeout;
6. separación entre categorías modales;
7. comparación con un baseline greedy en cruce;
8. comparación con un baseline que ignora detecciones de baja confianza.

Estos tests prueban propiedades lógicas del algoritmo. **No demuestran desempeño en condiciones reales de cámara.**

## Validación requerida antes de producción

El tracker no debe considerarse validado hasta compararse con secuencias anotadas que incluyan, al menos:

- baja, media y alta densidad;
- peatones en grupos;
- bicicletas adelantándose/cruzándose;
- buses y vehículos con oclusión parcial;
- detenciones y reinicio de movimiento;
- entradas/salidas por bordes de imagen;
- variaciones de FPS;
- contraluz y sombras;
- objetos pequeños/lejanos;
- oclusiones de duración distinta.

El informe debe comparar el v2 con el tracker legacy usando exactamente las mismas detecciones para aislar el aporte del tracking.

## Privacidad

El ID del tracker:

- se genera localmente;
- puede reiniciarse en cada sesión;
- no contiene información visual;
- no debe sincronizarse como identificador persistente entre cámaras;
- no debe utilizar embeddings de reidentificación entre nodos.

Konta2r necesita continuidad **dentro de una escena**, no seguimiento de individuos a través de la ciudad.
