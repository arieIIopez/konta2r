# Manifest multi-secuencia del corpus

## Propósito

`CorpusManifest` describe cómo varias secuencias anotadas se combinan en un corpus de benchmark. No contiene video, cajas ni coordenadas residenciales. Conserva identidad por SHA-256, split experimental y descriptores de observación.

La unidad del manifest es una secuencia ya congelada mediante su `annotationSha256` y, cuando existe, `mediaSha256`.

## Splits

- `development`: exploración, depuración y desarrollo del pipeline.
- `validation`: ajuste de decisiones como thresholds o comparación preliminar de candidatos.
- `held_out_test`: evaluación final reservada. No debe utilizarse para elegir thresholds o modificar el modelo.

El mismo archivo de anotaciones o video no puede aparecer en splits diferentes. Konta2r lo detecta por SHA-256.

## Independencia espacial

Un mismo `siteId` puede aparecer técnicamente en más de un split porque algunos diseños buscan evaluar cambios temporales, iluminación o densidad sobre una vista fija. El sistema lo informa como dependencia.

Si un `siteId` del `held_out_test` apareció antes en `development` o `validation`, el resultado final **no demuestra generalización espacial a un sitio/cámara nunca visto**. Para sostener esa afirmación, el held-out debe incluir sitios pseudónimos no presentes en los otros splits.

## Privacidad de ubicación

`siteId` es un pseudónimo opaco, por ejemplo:

- `site-001`
- `rm-seg-a17`
- `pilot_north_03`

No es un campo para domicilio, nombre de edificio o latitud/longitud. La sintaxis está restringida a letras, números, punto, guion y guion bajo, y se rechazan patrones que parezcan codificar pares de coordenadas precisas.

El manifest no necesita conocer la ubicación residencial desde la cual fue observado el espacio público.

## Descriptores

Cada secuencia registra:

- `sceneType`: tipología operacional del espacio observado;
- `lighting`: condición de iluminación;
- `viewAngle`: ángulo aproximado de observación;
- `deviceProfile`: perfil de ejecución del nodo, cuando se conoce;
- `tags`: etiquetas auxiliares no geográficas.

Estos campos describen cobertura. No crean por sí mismos representatividad estadística.

## Builder local

`?diagnostics=manifest-build` evita editar hashes y `sequenceId` manualmente. Para cada secuencia:

1. se selecciona el JSON producido por el anotador;
2. se selecciona el video/medio correspondiente cuando existe;
3. se declara split, `siteId` opaco y descriptores experimentales;
4. Konta2r deriva `sequenceId` desde las anotaciones;
5. calcula SHA-256 sobre los bytes locales en memoria acotada;
6. si las anotaciones ya declaran `source.mediaSha256`, el medio seleccionado debe reproducir exactamente ese hash;
7. la secuencia solo se añade si el manifest completo sigue superando `validateCorpusManifest()`.

El video no entra al JSON ni se persiste en el builder. Solo se conserva su digest.

## Flujo recomendado

1. Anotar cada secuencia con `?diagnostics=annotate`.
2. Revisar composición intrasecuencia con `?diagnostics=corpus`.
3. Construir entradas y hashes con `?diagnostics=manifest-build`.
4. Asignar splits y pseudónimos de sitio antes de evaluar el held-out.
5. Congelar el `CorpusManifest`.
6. Revisar cobertura multi-secuencia con `?diagnostics=manifest`.
7. Ejecutar benchmarks de development/validation.
8. No consultar el held-out para decisiones de tuning.
9. Ejecutar held-out final y archivar reportes/versiones.

## Qué no significa la revisión automática

`CorpusManifestCoverage` no contiene `score`, `valid` ni `representative=true`. Sus hallazgos son descriptivos. La ausencia de una tipología puede ser esperable para una pregunta específica; del mismo modo, una lista completa de tipologías no garantiza representatividad.

La validez depende del objetivo de inferencia, protocolo de muestreo, independencia de los splits, calidad de ground truth y diversidad efectiva del piloto.
