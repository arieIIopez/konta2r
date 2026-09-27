# Anotación local del corpus

## Propósito

`?diagnostics=annotate` convierte el protocolo de ground truth de Konta2r en una superficie operativa. Permite seleccionar un video local, capturar frames representativos, dibujar cajas manuales y exportar un `AnnotatedBenchmarkSequence` compatible directamente con `?diagnostics=benchmark`.

El video no se incorpora al repositorio, IndexedDB, service worker, Community ni backend. La superficie trabaja con un `ObjectURL` temporal y lo revoca al reemplazar el video o abandonar la página.

## Unidad de anotación

Cada frame capturado registra:

- `frameId` estable;
- `mediaTimeMs` del punto visible del video;
- `timestampMs` lógico, inicialmente igual a `mediaTimeMs`;
- resolución fuente del video;
- objetos ground truth con cajas en píxeles de esa resolución fuente.

La igualdad inicial entre `timestampMs` y `mediaTimeMs` es una conveniencia del anotador, no una equivalencia conceptual. El benchmark mantiene ambos campos separados y verifica la calidad temporal del seek durante la ejecución.

## Clases

La superficie limita deliberadamente la etapa de detector bruto a:

`person`, `bicycle`, `motorcycle`, `car`, `bus`, `truck`.

No se anota `cyclist` ni `motorcyclist` aquí. Una persona sobre bicicleta debe seguir la semántica del detector bruto que se está evaluando; la construcción de entidades modales compuestas pertenece al benchmark posterior de fusión modal.

## Cajas

El canvas puede escalar visualmente con el navegador, pero el editor transforma el arrastre a las coordenadas de la resolución original del video. Por tanto, cambiar el tamaño de la ventana no cambia el ground truth exportado.

Una caja accidental menor a tres píxeles fuente por lado se descarta. El schema general admite cajas parcialmente truncadas siempre que intersecten el frame; `ignore=true` debe usarse según el manual metodológico y no para ocultar objetos difíciles.

## Oclusión e ignore

Cada objeto puede marcarse como:

- `none`;
- `partial`;
- `heavy`.

`ignore` es independiente de la oclusión. Una oclusión severa no implica automáticamente exclusión: si un anotador puede identificar y delimitar razonablemente el objeto, debe permanecer evaluable.

## Muestreo de frames

La herramienta permite capturar frames fuera de orden; el JSON se ordena por `mediaTimeMs` antes de validar y exportar. Si se intenta capturar exactamente el mismo `mediaTimeMs` dos veces, se reutiliza el frame existente.

Para el piloto no conviene seleccionar muchos frames consecutivos de una única escena. Debe priorizarse diversidad de:

- densidad;
- distancia/tamaño aparente;
- oclusión;
- modo;
- iluminación;
- ángulo de cámara;
- tipología vial y de espacio público.

## Identidad y trazabilidad

El anotador no declara su propio SHA-256. Después de exportar el JSON, `?diagnostics=benchmark` calcula el hash sobre los bytes reales del archivo seleccionado. El video se hashea del mismo modo por chunks.

Esto evita que un manifest sea autoridad sobre su propia identidad.

## Revisión

La superficie permite reimportar un JSON compatible y continuar anotándolo. Para el corpus de validación final, una submuestra debe ser anotada independientemente por una segunda persona y los desacuerdos deben revisarse antes de congelar la versión de validación.

## Alcance

Esta primera versión busca producir un corpus piloto pequeño y auditable; no pretende reemplazar herramientas especializadas de anotación masiva. Antes de escalar a miles de frames conviene comprobar el flujo completo:

`video local → anotación → JSON → benchmark real → reporte → revisión de errores`.
