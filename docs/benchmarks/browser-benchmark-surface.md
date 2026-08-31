# Benchmark local en navegador

## Objetivo

`?diagnostics=benchmark` es una superficie diagnóstica, separada del nodo operativo, para ejecutar un checkpoint ONNX externo contra una secuencia anotada y un video local sin subir esos archivos a un backend.

El flujo es:

`diagnóstico ONNX → checkpoint local → anotaciones → video → hashes → detector → benchmark streaming → reporte → gate de validez`

## Entradas

Se requieren cuatro archivos locales:

1. diagnóstico JSON exportado por `?diagnostics=onnx`;
2. checkpoint `.onnx` correspondiente al candidato del diagnóstico;
3. `AnnotatedBenchmarkSequence` JSON;
4. video asociado a la secuencia anotada.

El diagnóstico debe obtener `verified` en el gate técnico. El checkpoint se hashea por chunks y solo se materializa por completo después de coincidir con el SHA-256 registrado. Las anotaciones y el video reciben hashes calculados directamente sobre sus bytes locales; esos hashes tienen precedencia sobre valores declarados dentro del JSON.

## Sincronización temporal

Cada frame usado con video debe declarar `mediaTimeMs`.

En perfil `selection`:

- se exige evidencia de frame presentado mediante `requestVideoFrameCallback`;
- la tolerancia de seek usada por la superficie es 50 ms;
- la ausencia de evidencia temporal impide completar una corrida estricta.

En perfil `development`:

- la tolerancia de seek es 100 ms;
- la evidencia temporal puede ser menos completa y el gate puede clasificar la corrida como `provisional`.

`currentTime` se utiliza para solicitar el seek, pero no se trata por sí solo como evidencia del frame efectivamente presentado.

## Métricas

La primera superficie usa:

- `minConfidence = 0.50` fijo;
- IoU de matching configurable, inicialmente 0.50;
- matching uno-a-uno por clase;
- precision, recall y F1 por clase;
- macro F1;
- IoU medio entre verdaderos positivos;
- recall por escala de imagen y oclusión;
- latencia e inference FPS;
- error temporal de seek cuando está disponible.

El F1 mostrado es una medición a un umbral de confianza y un umbral IoU concretos. **No es mAP COCO** y no debe denominarse así.

## Salidas

La interfaz puede exportar:

- JSON completo de la sesión, incluyendo `report` y `validity`;
- CSV resumen por clase;
- CSV de recall estratificado por escala y oclusión.

El resultado numérico y el dictamen científico permanecen separados. Un detector puede obtener buenas métricas y aun así producir una corrida `invalid` si la evidencia experimental no satisface el perfil seleccionado.

## Privacidad y persistencia

La superficie no sube checkpoint, video ni anotaciones. Tampoco los incorpora al service worker, IndexedDB o Community. El `ObjectURL` temporal del video se revoca al terminar cada corrida o al reemplazar el archivo.

Los bytes completos del ONNX existen en memoria solamente después de verificar su SHA-256 y durante la ejecución experimental. El factory del detector mantiene `weightsRedistributionVerified=false` mientras la revisión jurídica de pesos siga separada.

## Uso para selección de detector

Una corrida aislada no selecciona un modelo. La decisión entre candidatos debe usar un corpus suficientemente diverso y comparar, como mínimo, calidad por clase/estrato, latencia p50/p95, estabilidad, backend, dispositivo y validez experimental. El benchmark debe repetirse en dispositivos representativos de los perfiles `eco`, `balanced` y `performance`.
