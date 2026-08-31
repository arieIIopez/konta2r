# Formato de reporte del benchmark de detectores

## Fuente de verdad

Cada corrida válida produce un `DetectorBenchmarkReport` JSON versionado. Ese JSON es la fuente de verdad del benchmark porque conserva conjuntamente:

- identidad de la corrida;
- fecha;
- corpus y secuencias;
- hashes del corpus cuando estén disponibles;
- identidad del dispositivo;
- identidad/hash del modelo;
- runtime y execution providers;
- configuración de matching;
- métricas por clase;
- métricas de latencia;
- recall por escala y oclusión;
- resultados por frame y matches individuales.

Los CSV son vistas derivadas para análisis estadístico y no sustituyen al JSON.

## Identidad del corpus

Un reporte debe incluir:

- `datasetId`;
- uno o más `sequenceIds`;
- `frameCount`;
- `annotationSha256` cuando el JSON de anotaciones esté congelado;
- `mediaSha256` cuando exista una única fuente multimedia verificable.

`frameCount` debe coincidir con el resultado del benchmark. El constructor del reporte rechaza inconsistencias.

## Identidad del dispositivo

El campo mínimo obligatorio es un `label` definido por el investigador. Puede complementarse con:

- user agent;
- número de hilos lógicos;
- memoria informada por el navegador;
- disponibilidad de WebGPU.

Estos campos caracterizan el entorno de ejecución, no a una persona. Los reportes del benchmark no deben incluir ubicación, imágenes, video ni identificadores de sujetos observados.

## CSV resumen

`detectorBenchmarkSummaryCsv()` genera una fila por clase y corrida, incluyendo:

- corpus/dispositivo/modelo;
- backend/runtime;
- TP, FP, FN;
- precision, recall, F1 y macro-F1;
- IoU medio de TP;
- p50/p95 total e inferencia;
- FPS efectivo;
- drift de latencia.

Esto permite concatenar resultados de múltiples teléfonos y modelos en una sola tabla sin perder el vínculo con `runId`.

## CSV de estratos

`detectorBenchmarkStrataCsv()` produce filas de recall para:

- escala aparente en imagen;
- oclusión.

No contiene precision por estrato, porque los FP no poseen una categoría de ground truth atribuible de manera objetiva.

## Reproducibilidad

Para una comparación publicable, cada resultado usado en tablas o gráficos debe poder rastrearse hasta:

1. reporte JSON;
2. SHA-256 del checkpoint;
3. corpus/anotaciones identificados;
4. versión de Konta2r;
5. dispositivo/runtime;
6. configuración de matching.

Un CSV sin su JSON fuente debe considerarse una tabla de trabajo, no evidencia primaria del benchmark.
