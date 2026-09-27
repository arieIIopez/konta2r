# Integración experimental de RelateAnything

## Estado

**Experimental. No constituye todavía validación de RelateAnything sobre escenas urbanas de Konta2r.**

El objetivo de esta integración es implementar el contrato técnico de un `RelationProvider` compatible con los artefactos ONNX publicados por Maelic/RelateAnything, manteniendo separados:

- detector de objetos de Konta2r;
- candidate gate;
- relation model;
- persistencia temporal;
- interpretación Public Life.

Implementación:

`src/relations/relateAnythingOnnx.ts`

## Contrato técnico verificado en upstream

La implementación se basa en los archivos públicos:

- `deploy/export_onnx.py`;
- `deploy/runtime.py`;
- `relsgg/scoring.py`;
- `deploy/dist/relsgg-vits16/relateanything.json`.

Repositorio:

https://github.com/Maelic/RelateAnything

El release ViT-S/16 exportado el 2026-08-27 declara:

```text
image      float32 [1, 3, 448, 448]
boxes      float32 [1, 32, 4]     # cx, cy, w, h normalizados
box_counts int64   [1]

W          float32 [V, 512]       # vocab-mode=input
alpha      float32 [V]

pred_logits  [1, K, V]
pair_logits  [1, K]
sub_idx      [1, K]
obj_idx      [1, K]
valid_mask   [1, K]

K <= final_budget = 128
```

La imagen se redimensiona directamente a un cuadrado y se convierte a RGB/NCHW en rango [0,1]. No se aplica letterbox en el relation head.

Las cajas se normalizan respecto del frame original y se convierten de `xywh` a `cxcywh`.

## Score contract

Se replica literalmente el contrato publicado por upstream:

```text
score = sigmoid(a * (pred_logit + w * pair_logit) + b)
```

Para `relsgg-vits16`:

```text
a = 0.5377
b = -1.9694
w = 1
```

Konta2r mantiene esta calibración dentro del contrato del artefacto y no vuelve a calibrarla silenciosamente.

## Candidate gate

RelateAnything puede devolver pares entre las regiones que recibe, pero Konta2r no acepta automáticamente cualquier par producido por el modelo.

Antes de inferencia:

```text
tracks + semantic elements
        ↓
candidate gate
        ↓
pares autorizados
```

Después de inferencia, cualquier salida cuyo par sujeto→objeto no esté en el conjunto autorizado se descarta.

Así la geometría decide **qué vale la pena evaluar**, no si la relación existe.

## Vocabulario dinámico

Los releases actuales están exportados con `vocab_mode=input`.

Por ello el browser necesita:

- la matriz `W`;
- `alpha`;
- nombres de predicados;
- opcionalmente thresholds calibrados.

Upstream genera un banco `predicate_bank.npz`, y su script web lo convierte también a JSON.

Konta2r define `RelateAnythingPredicateBank` como representación explícita en memoria para evitar introducir un parser NPZ en el runtime.

Una frase open-vocabulary que no exista en el banco suministrado **no se inventa ni se aproxima**. El provider falla con un mensaje explícito hasta que ese predicado haya sido codificado con el text student/predicate encoder correspondiente.

## Licencia

El código upstream se publica bajo Apache-2.0.

Los checkpoints son derivados de DINOv3 y tienen condiciones distintas del código. Por eso:

```text
weightsRedistributionVerified = false
```

en el contrato integrado.

El modo experimental puede trabajar con un artefacto suministrado externamente, pero el modo `bundled_production` exige:

- SHA-256 del modelo;
- licencia de código;
- licencia de pesos;
- revisión positiva de redistribución.

Hasta completar esa revisión no se incorporarán pesos al bundle de Konta2r.

## Semántica de salida

El adapter declara `scoreSemantics = thresholded_partial`.

Esto es importante porque upstream aplica selección/budget de pares y Konta2r además puede aplicar thresholds. Por tanto, que un par/predicado no aparezca en la salida **no demuestra score 0**.

El runtime experimental documentado en `docs/public-life-runtime.md` conserva esa diferencia mediante `pair_not_scored`.

## Limitaciones actuales

### 1. Sin runtime smoke real todavía

Los tests actuales validan:

- preparación del contrato;
- shapes;
- vocabulario dinámico;
- score contract;
- mapeo sujeto/objeto;
- respeto del candidate gate.

Todavía falta ejecutar un ONNX real de RelateAnything con ONNX Runtime Web en Patana/browser y registrar evidencia reproducible.

### 2. External data / chunks

El export web upstream puede dividir modelos grandes en external-data/chunks.

El adapter inicial acepta un `OnnxModelSource` que el runtime pueda abrir directamente. La carga explícita de bundles troceados queda como gate separado.

No se afirmará compatibilidad con los bundles chunked hasta ejecutar ese flujo.

### 3. Banco de predicados

El adapter acepta un banco ya convertido a estructura JS/JSON.

No descarga ni convierte automáticamente `predicate_bank.npz`.

### 4. Predicados experimentales

`walking with`, `sitting with`, `pushing` y `walking beside` siguen siendo hipótesis open-vocabulary. Necesitan embeddings compatibles y benchmark propio antes de usarse.

### 5. Sin integración productiva del pipeline

El provider todavía no se ejecuta dentro de `MobilityFrameProcessor`.

La integración debe ocurrir después de:

1. runtime smoke real;
2. corpus mínimo;
3. sampling temporal;
4. medición de latencia/memoria;
5. revisión de licencia.

## Gate siguiente

El siguiente paso técnico es producir una evidencia equivalente a los probes de detector:

```text
modelo exacto
+ SHA-256
+ sidecar
+ banco
+ ONNX Runtime Web
+ frame sintético/real
+ cajas conocidas
+ outputs observados
+ latencia
```

Eso permitirá decidir si el adapter pasa de **contract verified** a **runtime verified**.
