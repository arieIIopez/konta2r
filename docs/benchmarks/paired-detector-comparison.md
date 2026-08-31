# Comparación pareada de detectores

## Propósito

Una diferencia entre dos reportes no es atribuible al detector si también cambian el corpus, el dispositivo o la política de evaluación. Konta2r trata por ello la comparación SSD–NanoDet como un diseño pareado: cada candidato debe observar exactamente los mismos frames anotados bajo una política común.

La capa `pairedBenchmarkComparison.ts` no selecciona un modelo. Primero evalúa si la comparación es metodológicamente válida y recién después calcula diferencias direccionales.

## Condiciones de comparabilidad estricta

Dos ejecuciones son `strict` únicamente si coinciden:

- identidad del dataset y secuencias;
- cantidad de frames;
- SHA-256 de anotaciones y medio, cuando existen;
- identidad y split del manifest congelado;
- identidad registrada del dispositivo;
- IoU de matching y umbrales de escala aparente;
- operating confidence threshold;
- grilla completa del confidence sweep.

Una discrepancia en cualquiera de estos elementos invalida la comparación pareada.

Si el backend ejecutado difiere —por ejemplo, un modelo corre en WebGPU y otro cae a WASM— la comparación se conserva como `conditional`. El resultado sigue describiendo la experiencia de despliegue observada, pero la diferencia de latencia no puede atribuirse exclusivamente a la arquitectura del detector.

## Piso de confianza

Cuando se solicita confidence sweep, `runExternalCandidateBenchmarkSession` fuerza por defecto el piso de retención del detector al menor threshold de la grilla. Esto es especialmente importante para NanoDet: su umbral operativo histórico de 0,35 no puede aplicarse antes de un sweep que comienza en 0,05, porque las detecciones descartadas no son recuperables después de la inferencia.

## Métricas comparadas

La comparación registra, sin producir una decisión automática:

- macro F1 y mejor macro F1 observado en el sweep;
- IoU medio de matches;
- precision, recall y F1 por clase;
- inferencia p50/p95;
- end-to-end p50/p95;
- FPS efectivo;
- deriva de latencia.

Los deltas se expresan como `right - left`. El signo no tiene una interpretación universal: un delta positivo es favorable para F1/FPS, mientras uno negativo es favorable para latencia.

## Interpretación para el perfil eco

NanoDet solo deberá reemplazar al baseline SSD en el perfil `eco` si el benchmark muestra que la reducción de tamaño y costo computacional no deteriora materialmente las variables que importan al producto: recall de peatones y ciclos, distinción modal, detección de objetos pequeños/ocluidos y continuidad térmica en teléfonos antiguos.

El resultado debe leerse junto con el gate de validez científica y con ensayos sostenidos. Una mejora de FPS en una prueba corta no prueba estabilidad térmica; una mejora de mAP publicada en otro corpus tampoco prueba mejor conteo en las escenas de ventana que caracterizan a Konta2r.
