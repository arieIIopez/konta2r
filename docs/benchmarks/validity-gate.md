# Gate de validez de corridas de benchmark

## Propósito

Una métrica numérica no convierte por sí sola una corrida en evidencia válida. Konta2r separa tres evaluaciones distintas:

1. desempeño del detector;
2. validez científica de la corrida;
3. elegibilidad jurídica/técnica del checkpoint para redistribución.

El gate de este documento cubre solo el segundo punto.

## Estados

### `valid`

La corrida satisface todos los requisitos exigidos por el perfil de validez seleccionado y no presenta errores temporales sobre el límite configurado.

### `provisional`

La corrida puede usarse para desarrollo o diagnóstico, pero faltan antecedentes que impiden tratarla como evidencia de selección final. Por ejemplo: no existe hash congelado del corpus o solo una parte de los frames de video tiene evidencia de tiempo presentado.

### `invalid`

Existe al menos una falla que impide interpretar la corrida como medición válida bajo el perfil solicitado. Un benchmark vacío o un error de seek sobre el máximo permitido son inválidos incluso en modo de desarrollo.

## Perfiles

### `development`

Por defecto:

- SHA-256 del modelo: recomendado, no obligatorio;
- SHA-256 de anotaciones: recomendado, no obligatorio;
- SHA-256 del video cuando existe timeline: recomendado, no obligatorio;
- evidencia `actualMediaTimeMs` para todos los frames temporizados: recomendada;
- error máximo de seek: 100 ms.

La ausencia de antecedentes recomendados produce `provisional`.

### `selection`

Por defecto:

- SHA-256 válido del checkpoint: obligatorio;
- SHA-256 de las anotaciones congeladas: obligatorio;
- si existen frames con `mediaTimeMs`, SHA-256 del medio: obligatorio;
- si existen frames con `mediaTimeMs`, evidencia de tiempo presentado para todos ellos: obligatoria;
- error máximo de seek: 50 ms.

Una carencia obligatoria produce `invalid`.

Los 50/100 ms son valores iniciales de control operacional y pueden revisarse después de observar el comportamiento real de los navegadores y el corpus. El umbral utilizado debe quedar declarado al evaluar la corrida.

## Evidencia temporal

Para un frame temporizado, el gate calcula el error desde los campos primarios:

`abs(actualMediaTimeMs - mediaTimeMs)`

No confía en un `seekErrorMs` almacenado previamente. Esto permite auditar nuevamente un reporte y evita que un campo derivado ausente o alterado oculte el desfase real.

La cobertura se calcula como:

`frames temporizados con actualMediaTimeMs / total de frames con mediaTimeMs`

Un corpus de imágenes sin `mediaTimeMs` no necesita evidencia de seek ni hash de un medio de video.

## Lo que el gate no decide

Un resultado `valid` no significa que:

- el detector tenga precisión suficiente;
- los pesos puedan redistribuirse;
- la fusión modal sea correcta;
- el tracking mantenga identidad suficientemente bien;
- el error final de conteo sea aceptable.

Esas decisiones pertenecen a otras capas de evaluación. La función del gate es evitar que una corrida metodológicamente incompleta entre a una comparación como si fuera equivalente a una corrida reproducible.
