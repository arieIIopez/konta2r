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

## Métricas y confidence

La superficie usa:

- piso de retención del adapter `minConfidence = 0.05`;
- punto operativo de evaluación `confidence = 0.50`;
- sweep de confidence 0.05–0.95 en incrementos de 0.05;
- IoU de matching configurable, inicialmente 0.50;
- matching uno-a-uno por clase;
- precision, recall y F1 por clase;
- macro F1;
- IoU medio entre verdaderos positivos;
- recall por escala de imagen y oclusión;
- latencia e inference FPS;
- error temporal de seek cuando está disponible.

La red neuronal se ejecuta una sola vez por frame. Las detecciones retenidas desde 0.05 se reutilizan para evaluar el punto operativo y todos los puntos del sweep. Si el adapter hubiese filtrado por encima del menor umbral solicitado, la sesión se rechaza porque la evidencia eliminada no puede reconstruirse.

El reporte mantiene separado el punto operativo de los valores `bestObserved...`. El mejor F1 observado en el corpus es descriptivo y puede sobreajustarse a ese mismo corpus; no se interpreta automáticamente como umbral recomendado.

El sweep produce puntos precision–recall discretos por clase y confidence. **No es mAP COCO**: todavía no integra Average Precision ni múltiples umbrales IoU según el protocolo COCO, por lo que no debe denominarse mAP.

## Salidas

La interfaz puede exportar:

- JSON completo de la sesión, incluyendo `report`, `confidence` y `validity`;
- CSV resumen del punto operativo por clase;
- CSV de recall estratificado por escala y oclusión;
- CSV del confidence sweep con precision, recall y F1 por clase/threshold.

El resultado numérico y el dictamen científico permanecen separados. Un detector puede obtener buenas métricas y aun así producir una corrida `invalid` si la evidencia experimental no satisface el perfil seleccionado.

## Privacidad y persistencia

La superficie no sube checkpoint, video ni anotaciones. Tampoco los incorpora al service worker, IndexedDB o Community. El `ObjectURL` temporal del video se revoca al terminar cada corrida o al reemplazar el archivo.

Los bytes completos del ONNX existen en memoria solamente después de verificar su SHA-256 y durante la ejecución experimental. El factory del detector mantiene `weightsRedistributionVerified=false` mientras la revisión jurídica de pesos siga separada.

## Uso para selección de detector

Una corrida aislada no selecciona un modelo. La decisión entre candidatos debe usar un corpus suficientemente diverso y comparar, como mínimo, calidad por clase/estrato, curvas de confidence, latencia p50/p95, estabilidad, backend, dispositivo y validez experimental. El benchmark debe repetirse en dispositivos representativos de los perfiles `eco`, `balanced` y `performance`.

Los umbrales elegidos para operación final deben validarse en datos distintos de aquellos utilizados para explorarlos o ajustarlos. De lo contrario, el `bestObserved` solo describe el corpus de ajuste y no constituye evidencia de generalización.
