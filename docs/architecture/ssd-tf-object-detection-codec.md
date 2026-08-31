# Codec SSD TensorFlow Object Detection

## Estado

Implementación experimental para evaluar conversiones ONNX de modelos SSD provenientes de TensorFlow Object Detection API. **No constituye selección de detector ni autorización para redistribuir pesos.**

## Problema que resuelve

El runtime ONNX de Konta2r es deliberadamente model-agnostic. Un modelo SSD-TF necesita una capa específica para:

- preparar RGB `uint8` en layout NHWC;
- usar el nombre de input observado;
- interpretar `detection_boxes`, `detection_scores`, `detection_classes` y `num_detections`;
- convertir cajas normalizadas `[ymin, xmin, ymax, xmax]` a píxeles del frame original;
- interpretar IDs COCO 1-based;
- retener únicamente clases que alimentan productos actuales de Konta2r.

## Contrato documentado de familia

El contrato inicial documentado es:

- input `image_tensor:0`;
- tensor `uint8`;
- shape `[1, 300, 300, 3]`;
- layout NHWC;
- outputs:
  - `detection_boxes:0`;
  - `detection_scores:0`;
  - `detection_classes:0`;
  - `num_detections:0`.

Este contrato proviene de documentación de conversiones del frozen graph `ssd_mobilenet_v2_coco_2018_03_29`. **No se aplica automáticamente a cualquier archivo llamado SSD MobileNet V2.**

## Barrera de activación

`SsdTfObjectDetectionCodec` tiene constructor privado. Solo puede construirse mediante:

```text
SsdTfObjectDetectionCodec.fromProbe(observedProbe, options)
```

La fábrica rechaza el modelo si el probe real no confirma:

1. input por nombre;
2. tipo `uint8`;
3. shape exacta `[1,300,300,3]`;
4. outputs requeridos por nombre;
5. outputs tensoriales y numéricos;
6. última dimensión de boxes igual a 4 cuando la metadata la declara.

Un probe que entrega únicamente nombres es insuficiente. La documentación de un tercero tampoco reemplaza el probe local.

## Clases iniciales

El decoder usa IDs COCO 1-based y conserva por defecto:

| id | clase |
|---:|---|
| 1 | person |
| 2 | bicycle |
| 3 | car |
| 4 | motorcycle |
| 6 | bus |
| 8 | truck |
| 17 | cat |
| 18 | dog |
| 41 | skateboard |

El objetivo es alimentar fusión modal, tracking y conteo sin propagar clases COCO que Konta2r no utiliza. Este filtrado no sustituye el benchmark de precisión por clase.

## Geometría

Las salidas SSD se convierten de coordenadas normalizadas a píxeles del frame original. Valores ligeramente menores que 0 o mayores que 1 se recortan al frame antes de producir `RawDetection`. Cajas degeneradas o no finitas se descartan.

## Candidatos actuales

### Kalray

Se mantiene como baseline externo `probe_pending`. El artefacto tiene hash registrado, pero su ficha no documenta con suficiente detalle el contrato IO como para activar el codec sin probe.

### OpenCV contribution 2026-07

Se registra como un segundo artefacto independiente. Su documentación declara explícitamente el contrato de TensorFlow Object Detection, demo ONNX Runtime y SHA-256. Aun así permanece `probe_pending` hasta que Konta2r observe el archivo real.

No se presupone equivalencia binaria ni funcional entre las conversiones Kalray y OpenCV.

## Licencia

La compatibilidad técnica del codec y el derecho de redistribución son gates diferentes. Ningún candidato entra al bundle mientras `redistributionVerified=false`, incluso si el probe y el benchmark son satisfactorios.

## Validación mínima antes de benchmark

```text
artefacto externo
  → SHA-256 verificado
  → probe ONNX real
  → assessment de contrato
  → codec SSD-TF
  → adapter ONNX
  → benchmark anotado
  → gate de validez científica
  → decisión por perfil Edge
```
