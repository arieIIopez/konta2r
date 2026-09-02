# Muestreo reproducible de frames para ground truth

## Problema metodológico

Un corpus puede tener cajas perfectamente anotadas y aun así producir una evaluación sesgada si los frames fueron elegidos por conveniencia. Buscar manualmente escenas “interesantes”, objetos difíciles o momentos donde sabemos que el detector falla cambia el denominador del experimento. Lo mismo ocurre en sentido contrario si se eligen principalmente escenas limpias y fáciles.

Konta2r separa por eso dos procedencias de frame:

- `planned`: deriva de un plan temporal reproducible creado antes de observar/anotar esos puntos;
- `manual`: fue incorporado deliberadamente por el investigador fuera de ese plan.

Los frames manuales son útiles para diagnóstico, casos adversariales y desarrollo. No deben sustituir silenciosamente a las muestras planificadas cuando se reporta desempeño representativo de una secuencia.

## Estrategia inicial

`createTemporalSamplingPlan()` implementa `stratified_uniform_jitter`.

La duración útil del video se divide en `N` estratos temporales iguales. Cada estrato aporta exactamente un punto. El punto parte desde el centro del estrato y recibe un desplazamiento pseudoaleatorio limitado por `jitterFraction`.

Esto combina dos propiedades:

1. cobertura temporal: cada sección del video aporta una observación;
2. reproducibilidad: la misma configuración y `seed` regeneran exactamente los mismos tiempos solicitados.

No se usa muestreo aleatorio simple porque podría concentrar varios puntos en un intervalo corto y dejar zonas del video sin representación.

## Campos auditables

El `TemporalSamplingPlan` guarda:

- estrategia y versión de schema;
- duración de la fuente;
- número de muestras;
- `seed`;
- márgenes inicial/final;
- `jitterFraction`;
- lista completa de `plannedMediaTimesMs`.

La validación regenera el plan desde sus parámetros. Si un tiempo fue editado después, el plan deja de validar.

Cada frame `planned` guarda además:

- `planIndex`;
- `requestedMediaTimeMs` proveniente del plan;
- `mediaTimeMs` realmente presentado/capturado por el navegador.

La diferencia requested/actual no se borra. Esa separación permite auditar el comportamiento del reproductor y evita reescribir el diseño experimental con el frame que finalmente entregó el navegador.

## Tolerancia del anotador

La superficie `?diagnostics=annotate` usa inicialmente una tolerancia operacional de **±250 ms** para aceptar una captura como la muestra planificada. Si el frame presentado está más lejos, la UI no lo registra como `planned`.

Esta tolerancia solo decide si el anotador puede atribuir el frame al punto solicitado. **No reemplaza la auditoría temporal del benchmark.** Durante la corrida, el proveedor browser vuelve a registrar requested/presented media time y el validity gate aplica sus propios criterios.

## Frames manuales

Un frame explorado y capturado fuera del flujo “Ir a siguiente muestra” se guarda con:

```text
selection.source = manual
```

No recibe `planIndex` ni `requestedMediaTimeMs`.

Esto permite construir conjuntos complementarios, por ejemplo:

- muestra planificada para estimar desempeño representativo;
- frames manuales/adversariales para estudiar fallas específicas;
- casos raros añadidos para desarrollo de fusión/tracking.

Los resultados de esos conjuntos deben informarse separados cuando respondan preguntas distintas.

## Evitar ajuste sobre el mismo corpus

El confidence sweep puede mostrar el mejor F1 **observado** dentro de un corpus. Ese umbral no debe asumirse automáticamente como recomendado para producción.

Para una comparación defendible:

1. usar un conjunto de desarrollo para explorar codecs, thresholds y decisiones de diseño;
2. congelar configuración;
3. evaluar después en un conjunto held-out cuyo muestreo/anotación no haya sido usado para ajustar el modelo;
4. conservar hashes, plan de muestreo y reportes de ambas fases.

## Muestreo temporal no resuelve toda la representatividad

Un video individual representa una sola cámara, ubicación, orientación, hora y condición ambiental. El muestreo temporal reduce sesgo **dentro de esa secuencia**, pero no convierte una secuencia en representativa de toda la red Konta2r.

El corpus multi-secuencia debe cubrir deliberadamente tipologías diferentes: densidad, modos, ángulos, iluminación, oclusión, distancia a cámara y dispositivos. Esa estratificación entre escenas pertenece al diseño general del corpus y se mantiene separada del muestreo temporal dentro de cada video.
