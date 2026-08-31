# Corpus anotado para benchmark de detectores

## Propósito

Este corpus permite comparar detectores mediante el mismo contrato `Detector`, sin hacer depender tracking, fusión modal ni conteo de una familia neuronal concreta. El objetivo no es demostrar que un modelo es bueno en COCO en abstracto, sino medir su desempeño en escenas reales de movilidad relevantes para Konta2r.

## Unidad de evaluación

La unidad básica es un frame anotado. Cada objeto evaluable contiene:

- `annotationId` único dentro del frame;
- `className` canónico;
- `bbox` en píxeles de la imagen fuente (`x`, `y`, `width`, `height`);
- `occlusion`: `none`, `partial` o `heavy`;
- `ignore=true` cuando el objeto está presente pero no debe participar en el denominador de evaluación.

La imagen o video no se almacena dentro del JSON de anotaciones. El corpus debe mantener por separado la referencia y, cuando sea posible, SHA-256 del medio y de la anotación.

## Clases canónicas iniciales

Para el benchmark del detector deben usarse, como mínimo, las clases que alimentan la semántica de movilidad:

`person`, `bicycle`, `motorcycle`, `car`, `bus`, `truck`.

`cyclist`, `motorcyclist` y otras entidades compuestas pertenecen a la evaluación de fusión modal, no al detector bruto. Un detector COCO que entregue `person` + `bicycle` no debe ser premiado o castigado en esta etapa por la calidad de la fusión posterior.

## Matching

El matching es uno-a-uno, por clase, usando asignación global Hungarian y costo `1 - IoU`. Esto evita que el orden de salida del detector altere el resultado cuando varios objetos están próximos.

Configuración inicial:

- IoU mínimo: `0.50`;
- una predicción puede emparejar con una sola anotación;
- una anotación puede emparejar con una sola predicción;
- clases distintas nunca se emparejan;
- una detección no emparejada puede ser absorbida por una anotación `ignore` de la misma clase si supera el mismo IoU, sin convertirse en FP.

El umbral debe guardarse dentro de cada resultado. Cambiarlo crea una configuración de benchmark distinta.

## Métricas

Se reportan por clase:

- TP, FP y FN;
- precision;
- recall;
- F1;
- IoU medio de los TP.

Se reportan además latencia end-to-end e inferencia p50/p95, FPS efectivo y drift de latencia entre la primera y segunda mitad de la corrida.

### Estratificación por dificultad

Para tamaño y oclusión se reporta **recall**, no precision. Un falso positivo no tiene una categoría de tamaño u oclusión de ground truth asignable sin introducir una decisión artificial.

El tamaño se expresa como escala en imagen según `bbox.height / frameHeight`, no como tamaño físico del objeto:

- `tiny`: < 0,04;
- `small`: >= 0,04 y < 0,10;
- `medium`: >= 0,10 y < 0,25;
- `large`: >= 0,25.

Estos límites son parámetros operacionales de Konta2r y deben quedar registrados en el resultado. Pueden cambiar después del primer corpus real, pero no deben cambiar entre modelos dentro de una misma comparación.

## Regla para `ignore`

`ignore=true` debe reservarse para casos donde no existe una etiqueta suficientemente defendible, por ejemplo:

- objeto truncado hasta un punto que impide delimitar razonablemente su caja;
- ambigüedad semántica real de clase;
- reflejo, pantalla u otra representación no perteneciente a la escena física;
- región deliberadamente excluida del benchmark.

No debe usarse para esconder falsos negativos difíciles. Objetos pequeños, lejanos u ocluidos siguen siendo evaluables si un anotador humano puede identificarlos y delimitarlos con criterio reproducible.

## Construcción del corpus

El corpus inicial debe cubrir tipologías distintas:

- ciclovías protegidas y no protegidas;
- calzadas con buses y vehículos pesados;
- cruces e intersecciones;
- veredas con distinta densidad peatonal;
- escenas de baja y alta oclusión;
- día, contraluz y condiciones nocturnas cuando el sensor lo permita;
- cámaras altas/bajas y ángulos oblicuos representativos de Konta2r Node.

No conviene muestrear solo frames consecutivos de una misma escena. La partición debe maximizar diversidad de condiciones y evitar que una secuencia fácil domine el resultado agregado.

## Control de calidad de anotaciones

Para el corpus de validación final se recomienda:

1. manual de anotación congelado antes de comparar modelos;
2. doble anotación independiente de una submuestra;
3. revisión de desacuerdos de clase, caja, oclusión e `ignore`;
4. registro de versión y SHA-256 del JSON final;
5. mantener el corpus de prueba sin usar para ajustar thresholds del detector.

La submuestra doble debe permitir cuantificar acuerdo entre anotadores antes de atribuir al modelo diferencias que en realidad provengan de ground truth inestable.

## Alcance de las métricas actuales

El harness implementado calcula precision/recall/F1 para un umbral IoU determinado. **No debe denominarse mAP COCO.** Una métrica mAP requiere integrar precision-recall sobre thresholds/confidencias y, en el esquema COCO, múltiples IoU. Esa extensión podrá añadirse cuando el corpus y los codecs estén estabilizados.

## Siguiente nivel de evaluación

Después de seleccionar detectores competitivos, Konta2r debe evaluar también:

`detección → fusión modal → tracking → eventos`.

Un detector con mejor F1 bruto puede no producir el mejor conteo si sus errores temporales, duplicaciones o cajas inestables degradan tracking y fusión. Por eso la selección final deberá considerar tanto benchmark de detección como error del producto de medición.
