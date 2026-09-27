# Smoke reproducible — RelateAnything vits16plus

## Resultado

**Estado: runtime verificado en ONNX Runtime Web/WASM sobre el runner Patana.**

Esto demuestra que el grafo ONNX publicado puede cargarse y ejecutar inferencia real con el banco de predicados publicado.

No demuestra todavía precisión sobre escenas Public Life ni rendimiento aceptable en teléfono.

Evidencia versionada:

`docs/benchmarks/evidence/relateanything-vits16plus-ort-web-wasm-smoke.json`

## Release exacto

| campo | valor |
|---|---|
| repositorio | `maelic/relsgg-vits16plus` |
| revision HF | `2db90096be5217bdc7a9003c042950f45723d105` |
| export upstream | 2026-08-27 |
| git upstream | `e9ea42aed60f766f12ad19d51709129c50110a3b` |
| ONNX SHA-256 | `b8b6a047c5e0771a897a5015c2ffb09d8fe5e3ffa0651e1e61af0e8436a3617a` |
| ONNX tamaño | 207,881,414 bytes |
| predicate bank SHA-256 | `708f812d6579eab1be85b3378b79e376453c2d4f65b4fad9bcebb9f5bf05da06` |
| calibration SHA-256 | `ccf8570123d49233b32587b16224e5708442489ba17525d4b4664646346e3ecb` |

El contrato correspondiente está fijado en:

`RELATEANYTHING_VITS16PLUS_2026_08_27`

## Contrato observado

El ONNX real expuso dimensiones dinámicas:

```text
image      float32 [batch, 3, 448, 448]
boxes      float32 [batch, num_boxes, 4]
box_counts int64   [batch]
W          float32 [num_predicates, 512]
alpha      float32 [num_predicates]

pred_logits float32 [batch, num_pairs, num_predicates]
pair_logits float32 [batch, num_pairs]
sub_idx     int64   [batch, num_pairs]
obj_idx     int64   [batch, num_pairs]
valid_mask  bool    [batch, num_pairs]
```

Para el smoke:

- batch = 1;
- dos cajas activas;
- cinco predicados;
- presupuesto de salida observado = 128 pares.

Las dimensiones simbólicas son compatibles con el contrato de Konta2r y no constituyen un error.

## Banco exacto

El banco publicado contiene:

```text
names  [243]
W      [243, 512]
alpha  [243]
thr    [243]
```

Los cinco predicados prioritarios extraídos exactamente del banco fueron:

| predicado | índice | threshold publicado |
|---|---:|---:|
| sitting on | 3 | 0.975 |
| leaning against | 17 | 0.985 |
| talking to | 12 | 0.990 |
| riding | 1 | 0.980 |
| holding | 5 | 0.975 |

Estos thresholds son evidencia del checkpoint upstream, no thresholds Public Life validados para Konta2r.

## Calibración

El release vits16plus declara:

```text
score = sigmoid(0.5651 * (pred_logit + pair_logit) - 1.9623)
```

Esto difiere del contrato histórico vits16.

Por tanto Konta2r mantiene ambos contratos separados y no reutiliza calibraciones entre checkpoints.

## Ejecución observada

Con imagen sintética uniforme y dos cajas:

```text
pred_logits [1,128,5]
pair_logits [1,128]
sub_idx     [1,128]
obj_idx     [1,128]
valid_mask  [1,128]
```

Todos los outputs fueron finitos.

En el run registrado:

- creación de sesión WASM: ~3.1 s;
- inferencia: ~6.3 s;
- threads WASM: 1;
- delta RSS del proceso Node: ~642 MB.

Estas cifras son sólo diagnóstico de smoke.

No deben interpretarse como latencia ni memoria esperada en:

- Chrome;
- WebGPU;
- Android;
- perfiles `eco / balanced / performance`.

## External data

La revisión HF utilizada contenía 13 archivos y **no publicó archivos external-data asociados al ONNX**.

El ONNX de 207.9 MB abrió correctamente como:

```text
single_file
```

Por tanto queda verificado que **este release exacto no requiere external-data/chunks**.

Esto no demuestra compatibilidad genérica con futuros releases troceados.

## Hallazgo sobre vits16

El primer smoke apuntó a `maelic/relsgg-vits16`.

Su model card enumera `relateanything.onnx`, pero la API de archivos consultada durante el run no lo ofrecía, por lo que el gate se detuvo antes de inferencia.

Konta2r no trata esa discrepancia como fallo del runtime.

Se cambió el smoke al release `vits16plus`, actualmente recomendado upstream y con ONNX efectivamente descargable.

## Reproducibilidad

La cadena automatizada es:

```text
HF model API
   ↓
fetch exact revision
   ↓
hash ONNX/bank/calibration/thresholds
   ↓
extract exact rows from predicate_bank.npz
   ↓
onnxruntime-web / WASM
   ↓
synthetic image + known boxes
   ↓
validate IO + finite outputs
   ↓
commit evidence JSON
```

Herramientas:

- `tools/fetch_relateanything_release.mjs`;
- `tools/extract_relateanything_bank.py`;
- `tools/smoke_relateanything_ort_web.mjs`;
- workflow `.github/workflows/relateanything-wasm-smoke.yml`.

## Gate siguiente

A partir de este resultado el bloqueo ya no es “¿corre el ONNX?”.

Los siguientes gates son:

1. smoke **browser-native** en Chromium, primero WASM y luego WebGPU;
2. frame real + cajas provenientes del pipeline Konta2r;
3. corpus Public Life anotado;
4. benchmark A/B/C/D;
5. calibración propia por predicado/contexto;
6. ensayo sostenido de memoria/temperatura;
7. revisión de licencia antes de cualquier redistribución.

El estado correcto es:

```text
contract verified
+ runtime verified (Node host / ORT Web WASM)
≠ Public Life validated
≠ production eligible
```
