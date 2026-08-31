# Benchmark vinculado a manifest congelado

## Problema

Identificar un video y sus anotaciones por SHA-256 no basta para reconstruir el diseño experimental. Un mismo archivo puede pertenecer conceptualmente a desarrollo, validación o test final. Sin el manifest congelado, meses después no es posible demostrar qué función cumplía esa secuencia cuando se produjo una métrica.

## Enlace verificable

Antes de una corrida estricta, `?diagnostics=benchmark` calcula SHA-256 sobre:

1. anotaciones locales;
2. video/medio local;
3. `CorpusManifest` local.

El manifest se parsea como entrada no confiable y la secuencia debe existir con exactamente los mismos hashes. Solo entonces se crea `BenchmarkManifestIdentity`:

- `corpusId`;
- `sha256` del archivo manifest real;
- `split` de la secuencia.

No se copian `siteId`, dirección ni metadata de ubicación al reporte de benchmark.

## Perfiles

### development

Permite trabajo exploratorio. El manifest no es obligatorio; si falta, la corrida queda como evidencia provisional. No debe utilizarse como evaluación final.

### selection

Se utiliza para comparar candidatos o ajustar decisiones como confidence thresholds. Exige:

- hashes de modelo, anotaciones y medio;
- manifest congelado por SHA-256;
- secuencia perteneciente a `validation`;
- evidencia temporal completa del frame presentado;
- error de seek dentro del límite estricto.

Una secuencia `held_out_test` es rechazada en este perfil **antes de cargar o ejecutar el modelo**. Esto reduce el riesgo de tuning sobre el test final.

### final_evaluation

Exige las mismas condiciones de reproducibilidad que `selection`, pero la secuencia debe pertenecer a `held_out_test`.

Una secuencia `validation` o `development` es rechazada bajo este perfil.

## Reportes

`DetectorBenchmarkReport.corpus.manifest` conserva:

```text
corpusId
sha256
split
```

Los CSV de resumen, estratos y confidence sweep repiten esas tres columnas para que una tabla exportada continúe siendo auditable incluso separada del JSON original.

## Generalización espacial

Que una secuencia pertenezca a `held_out_test` no demuestra por sí solo generalización a sitios nunca vistos. `?diagnostics=manifest` informa si un `siteId` held-out apareció antes en development/validation.

Ese caso puede seguir siendo válido para preguntas de generalización temporal, densidad o iluminación sobre una vista conocida. Por eso no se invalida automáticamente: la afirmación científica debe corresponder al diseño del manifest.
