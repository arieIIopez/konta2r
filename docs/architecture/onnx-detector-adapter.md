# Adapter ONNX genérico

## Propósito

Konta2r ejecutará detectores ONNX en el dispositivo sin hacer depender el núcleo de una familia de modelos determinada. El contrato permanece:

```text
CanvasImageSource
  ↓
OnnxDetectorCodec.prepare()
  ↓
ONNX Runtime Web
  ├─ WebGPU preferente
  └─ WASM fallback
  ↓
OnnxDetectorCodec.decode()
  ↓
RawDetection[]
  ↓
fusión modal → tracking → eventos
```

El adapter genérico **no conoce** YOLO, DETR, RTMDet u otra arquitectura concreta.

## Separación de responsabilidades

### `runtime.ts`

Responsable de:

- crear y liberar sesiones ONNX;
- intentar WebGPU cuando el navegador lo soporta;
- mantener WASM como fallback de compatibilidad;
- registrar versión de ONNX Runtime Web y execution providers;
- liberar explícitamente outputs que expongan `dispose()`.

La versión del runtime se mantiene fijada en `package.json` y reflejada en `ONNX_RUNTIME_WEB_VERSION` para trazabilidad experimental.

### `codec.ts`

Cada modelo candidato debe implementar su propio codec. El codec es responsable de:

- transformación de imagen a tensores;
- normalización de canales;
- nombres de inputs;
- dimensiones/layout NCHW/NHWC;
- lectura de outputs;
- conversión de coordenadas;
- NMS cuando el modelo no la incorpore;
- mapeo de clases.

Esto impide que una decisión experimental sobre un modelo contamine el tracker o el motor de conteo.

### `letterbox.ts`

Contiene transformaciones geométricas puras para modelos que utilicen letterbox. No presupone que todos los modelos lo necesiten.

### `adapter.ts`

Responsable de:

- verificar elegibilidad mínima del modelo;
- aplicar por separado el gate de redistribución para producción bundleada;
- medir preprocess, inference, postprocess y total;
- sanear detecciones inválidas;
- ordenar por confianza;
- aplicar un límite máximo de detecciones configurable/dinámico;
- liberar inputs preparados y outputs;
- exponer metadata reproducible del runtime.

## WebGPU y WASM

La documentación oficial de ONNX Runtime Web indica que WebGPU se habilita mediante el import `onnxruntime-web/webgpu` y `executionProviders`. Konta2r intenta inicialmente:

```ts
['webgpu', 'wasm']
```

cuando WebGPU está disponible. Si la creación de la sesión falla, reintenta:

```ts
['wasm']
```

WASM sigue siendo importante para teléfonos antiguos y para modelos con operadores no cubiertos por el execution provider GPU.

Referencias:

- https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
- https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- https://onnxruntime.ai/docs/tutorials/web/

## Elegibilidad y licencias

Se mantienen dos estados distintos:

### Experimento

Puede ejecutarse un modelo cuando dispone de:

- dimensiones de input válidas;
- mapa de clases.

Esto permite benchmarkear checkpoints sin afirmar que pueden redistribuirse.

### Producción bundleada

Requiere además:

- SHA-256 del modelo;
- licencia del código;
- licencia de los pesos;
- `weightsRedistributionVerified = true`.

El adapter no realiza una interpretación jurídica: aplica el gate documental definido por el registro de modelos.

## Telemetría

Cada inferencia devuelve:

- `preprocessMs`;
- `inferenceMs`;
- `postprocessMs`;
- `totalMs`;
- detecciones antes del saneamiento/límite;
- detecciones finales.

Estos tiempos alimentan posteriormente el monitor de salud del nodo y permiten comparar modelos bajo el mismo protocolo.

## Límite dinámico de detecciones

`maxDetections` puede ser un número o una función. Esto permite que una instancia futura consulte el perfil activo del nodo:

- eco: 60;
- balanced: 100;
- performance: 160.

El límite no reemplaza el benchmark del detector ni los umbrales por clase. Solo evita que escenas densas produzcan una carga posterior no acotada.

## Memoria y ciclo de vida

El código asume que los outputs ONNX pueden poseer recursos GPU. Por ello:

1. el codec decodifica los outputs;
2. el adapter llama `dispose()` sobre cada output único que lo exponga;
3. el codec puede proporcionar además un `dispose()` para sus feeds/recursos temporales;
4. `dispose()` del adapter libera finalmente la sesión.

La gestión de memoria es parte de la estabilidad 24–72 h y deberá medirse explícitamente en dispositivos físicos.

## Pendiente antes de usar cámara real

1. seleccionar al menos un checkpoint con licencia verificable para benchmark;
2. implementar su codec;
3. verificar SHA-256 y fuente;
4. probar WASM y WebGPU sobre el mismo corpus;
5. medir precisión por clase y después de fusión modal;
6. comprobar estabilidad prolongada y memoria;
7. definir estrategia offline de distribución/cache del modelo y archivos WASM;
8. solo entonces conectar el adapter al `RuntimeInferenceBridge` del panel PWA.
