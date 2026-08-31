# Integridad de archivos locales de benchmark

## Problema de autorreferencia

Un archivo JSON de anotaciones no puede contener de forma simple su propio SHA-256 y, al mismo tiempo, afirmar que ese valor es el hash del archivo completo: al insertar o modificar el hash cambian los bytes y cambia nuevamente el digest.

Por esa razón, Konta2r distingue:

- hashes declarados en un manifest o dentro del JSON;
- hashes **calculados desde los bytes reales del archivo seleccionado**.

Para reportes de benchmark, un hash calculado externamente tiene precedencia sobre el valor declarado dentro del corpus.

## Anotaciones

El JSON se procesa en dos etapas:

```text
archivo local
  → parser estructural de entrada no confiable
  → validador semántico de corpus
  → benchmark
```

No se utiliza un cast directo desde `JSON.parse()` al tipo `AnnotatedBenchmarkSequence`.

Se verifican, entre otros:

- `schemaVersion`;
- IDs de corpus/secuencia/frame;
- dimensiones;
- timestamps y `mediaTimeMs`;
- bounding boxes;
- oclusión;
- `ignore`;
- hashes declarados cuando existen;
- unicidad y orden temporal mediante el validador común.

## Video y archivos grandes

`SubtleCrypto.digest()` opera sobre un buffer completo. Para un video grande eso puede duplicar decenas o cientos de MB en memoria y contradice el objetivo de reutilizar teléfonos antiguos.

Konta2r incorpora un SHA-256 incremental para archivos locales:

```text
File/Blob
  → chunk 4 MB
  → IncrementalSha256.update()
  → siguiente chunk
  → digest final
```

El tamaño de chunk es configurable. El algoritmo se valida contra vectores SHA-256 publicados, incluido el vector de un millón de caracteres `a`, y contra particiones arbitrarias del mismo contenido.

El hashing del medio ocurre únicamente en el flujo diagnóstico/benchmark, no durante el conteo continuo del nodo.

## Precedencia en el reporte

Cuando la sesión recibe:

```text
corpusHashes.annotationSha256
corpusHashes.mediaSha256
```

esos valores sustituyen a los hashes declarados en `sequence.source` para construir la identidad del reporte.

El reporte añade notas de procedencia:

- `annotation_sha256_source:externally_computed_file_bytes`;
- `media_sha256_source:externally_computed_file_bytes`.

Esto permite distinguir una identidad realmente calculada de una afirmación de manifest.

## Privacidad

Calcular un hash no sube el archivo. Los chunks permanecen en el navegador y se liberan progresivamente. El digest identifica bytes del corpus/medio, no personas individuales detectadas en el contenido.
