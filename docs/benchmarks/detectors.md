# Benchmark de detectores ONNX para Konta2r v2

## Estado

**Diseño de benchmark — ningún detector seleccionado todavía.**

Konta2r no adoptará un detector por popularidad o por una cifra general de mAP. La selección debe considerar las clases de movilidad relevantes, escenas reales, capacidad de teléfonos antiguos, estabilidad durante operación prolongada y condiciones de redistribución del modelo.

## Runtime objetivo

ONNX Runtime Web.

Orden inicial de ejecución:

1. `webgpu` cuando esté soportado y el benchmark sostenido muestre ventaja;
2. `wasm` como fallback de máxima compatibilidad.

La documentación actual de ONNX Runtime Web permite configurar, por ejemplo, `executionProviders: ['webgpu', 'wasm']`.

Referencias:

- https://onnxruntime.ai/docs/get-started/with-javascript/web.html
- https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html

## Requisito de arquitectura

El resto de Konta2r consume la interfaz `Detector` y no conoce:

- arquitectura de red;
- nombres de tensores;
- NMS particular;
- familia YOLO/DETR/etc.;
- backend de inferencia.

Cada adapter debe producir `RawDetection[]` y telemetría normalizada.

## Variables mínimas por ejecución

### Identidad reproducible

- adapter ID;
- modelo;
- versión;
- SHA-256 de los pesos;
- URL/fuente;
- licencia del código;
- licencia de los pesos;
- verificación explícita de derecho de redistribución;
- tamaño del archivo;
- resolución de entrada;
- quantization/data type cuando corresponda;
- versión de ONNX Runtime Web;
- execution provider.

### Rendimiento

- preprocess p50/p95;
- inference p50/p95;
- postprocess p50/p95;
- end-to-end p50/p95;
- FPS efectivo de inferencia;
- detecciones antes/después de filtrado;
- deriva de latencia entre primera y segunda mitad de la prueba;
- memoria cuando sea observable de forma confiable;
- fallas/OOM;
- estabilidad después de 30 min, 2 h y ensayo prolongado cuando sea viable.

La media no será suficiente para caracterizar rendimiento. El tracking es sensible a pausas largas, por lo que p95 tiene mayor importancia operativa.

### Precisión

Por clase relevante:

- precision;
- recall;
- F1;
- error por tamaño aparente del objeto;
- error según oclusión;
- error según iluminación;
- error según densidad.

Clases mínimas de interés inicial:

- person;
- bicycle;
- motorcycle;
- car;
- bus;
- truck;
- skateboard si el modelo la contiene o existe un mecanismo equivalente.

La precisión final por **modo de movilidad** deberá evaluarse también después de la fusión modal, porque la precisión de `cyclist` no es idéntica a la precisión aislada de `person` o `bicycle`.

## Escenas de benchmark

El corpus deberá contener:

1. baja densidad;
2. alta densidad;
3. objetos pequeños/lejanos;
4. oclusión parcial;
5. ciclistas en grupo;
6. peatones junto a bicicletas estacionadas;
7. motocicletas entre vehículos;
8. buses/camiones parcialmente fuera del cuadro;
9. sombras fuertes;
10. contraluz;
11. noche si el nodo pretende operar de noche;
12. lluvia/vidrio/reflejos de ventana;
13. distintos ángulos y alturas de cámara.

Debe existir un conjunto de ajuste y otro de validación no utilizado para elegir thresholds.

## Dispositivos

Al menos tres estratos:

### Eco

Teléfono antiguo que represente la propuesta de reutilización de hardware.

### Balanced

Teléfono Android de gama media.

### Performance

Teléfono reciente con WebGPU y un computador de referencia para separar limitaciones del modelo de limitaciones del Edge.

Cada dispositivo ejecutará un benchmark corto inicial y un ensayo sostenido. El perfil final del nodo se decidirá por latencia observada, no solo por información nominal del hardware.

## Perfiles de inferencia iniciales

| perfil | objetivo | frecuencia orientativa | entrada orientativa |
|---|---|---:|---:|
| eco | continuidad térmica/compatibilidad | 2,5 Hz | 416 px |
| balanced | equilibrio | 5 Hz | 512 px |
| performance | máxima resolución temporal defendible | 10 Hz | 640 px |

Estos valores son puntos de partida para benchmark, no parámetros finales.

## Cribado preliminar de candidatos

### Baseline legacy — COCO-SSD

Se conserva únicamente como baseline histórico del `contador.html`. No es la arquitectura objetivo.

La comparación debe mostrar cuánto mejora o empeora cada candidato frente al sistema original bajo las mismas escenas.

### YOLOX Nano/Tiny — candidato técnico condicionado

Repositorio oficial:

- https://github.com/Megvii-BaseDetection/YOLOX

El código se declara Apache-2.0 y el proyecto soporta ONNX. Sin embargo, al 30-08-2026 existe una consulta abierta solicitando aclaración explícita sobre si los pesos oficiales preentrenados tienen las mismas condiciones de redistribución:

- https://github.com/Megvii-BaseDetection/YOLOX/issues/1865

**Decisión provisional:** puede investigarse como arquitectura/candidato de benchmark, pero Konta2r no debe redistribuir checkpoints oficiales hasta verificar explícitamente su licencia.

### RTMDet / MMDetection — candidato técnico condicionado

Repositorio:

- https://github.com/open-mmlab/mmdetection

MMDetection declara Apache-2.0. Existe, sin embargo, una consulta abierta acerca de la licencia de los checkpoints del Model Zoo:

- https://github.com/open-mmlab/mmdetection/issues/11484

**Decisión provisional:** misma regla: no asumir que licencia del repositorio = licencia del checkpoint.

### Ultralytics YOLO — no candidato por defecto

La política oficial vigente de Ultralytics indica que sus modelos YOLO están bajo AGPL-3.0 por defecto o una licencia comercial aplicable. Para Konta2r, cuyo repositorio principal está bajo Apache-2.0 y que podría ser utilizado por gobierno, academia, comunidad y terceros con distintos esquemas de despliegue, introducir esa dependencia tiene consecuencias de licencia que deben resolverse antes.

Referencia:

- https://www.ultralytics.com/license

**Decisión provisional:** no incorporarlo como dependencia predeterminada del core. Puede existir como experimento externo únicamente si se analiza previamente la compatibilidad jurídica/licenciamiento del caso de uso.

## Gate de licencia

Ningún modelo entra al bundle de producción mientras `weightsRedistributionVerified !== true`.

El registro del modelo debe conservar por separado:

- `codeLicense`;
- `weightsLicense`;
- `weightsRedistributionVerified`.

Una URL a un repositorio con licencia permisiva no es suficiente evidencia para marcar los pesos como redistribuibles.

## Criterio de decisión

La decisión no será una sola clasificación global. Puede existir más de un modelo válido:

- modelo `eco` para teléfonos antiguos;
- modelo `balanced`;
- modelo `performance`.

Se priorizará el menor modelo que alcance la calidad requerida para los productos de Konta2r. Un aumento marginal de mAP no justifica duplicar consumo/temperatura si no mejora materialmente conteo, identidad modal o trayectorias.

## Próximos pasos

1. seleccionar checkpoints con licencia verificable;
2. exportar/normalizar a ONNX;
3. escribir adapters específicos detrás de `Detector`;
4. construir corpus anotado de movilidad;
5. ejecutar benchmark reproducible;
6. calibrar thresholds por clase;
7. medir desempeño después de fusión modal;
8. decidir modelos por perfil Edge;
9. documentar resultados aquí con tablas reproducibles.
