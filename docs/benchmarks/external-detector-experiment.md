# Detector externo verificado para benchmark

## Propósito

Conectar un checkpoint externo técnicamente verificado al `OnnxDetectorAdapter` sin incorporarlo al bundle de Konta2r ni afirmar derechos de redistribución.

## Entradas obligatorias

`buildExternalCandidateDetector()` recibe simultáneamente:

1. candidato del registro de Konta2r;
2. `VerifiedOnnxArtifact` producido después de verificar SHA-256;
3. diagnóstico ONNX del mismo candidato;
4. opciones experimentales de runtime.

Antes de construir el detector se comprueba:

- hash del artefacto contra el registro;
- coherencia entre `sizeBytes` y bytes en memoria;
- gate técnico del diagnóstico igual a `verified`;
- codec soportado por el factory.

Para la primera implementación, el codec soportado es `ssd_tf_object_detection`.

## Metadata jurídica conservadora

El factory no copia `declaredLicense` a `weightsLicense` ni a `codeLicense`.

La declaración externa se conserva únicamente como nota de procedencia. El modelo experimental queda con:

```text
weightsRedistributionVerified = false
```

hasta que exista una revisión separada de licencia de pesos.

Por tanto, que un checkpoint pueda ejecutarse en benchmark no significa que Konta2r pueda redistribuirlo.

## Memoria y persistencia

El factory consume los bytes externos ya descargados/verificados y los entrega directamente a ONNX Runtime Web.

No debe:

- copiar el modelo al repositorio;
- incluirlo en el service worker;
- persistirlo en IndexedDB por defecto;
- enviarlo a Konta2r Community;
- convertirlo en asset PWA.

El lifecycle experimental esperado es:

```text
descarga externa explícita
  → SHA-256
  → probe
  → gate técnico
  → codec
  → detector en memoria
  → benchmark
  → dispose
```

## Relación con el benchmark

Este factory elimina la última dependencia estructural entre “probe técnico” y “detector ejecutable”. Una vez disponible evidencia real `verified`, el mismo detector puede pasar a:

- corpus anotado;
- runner streaming;
- proveedor de video local;
- reporte JSON/CSV;
- gate de validez científica.

El resultado del benchmark seguirá decidiendo calidad y rendimiento. El factory no presupone que SSD MobileNet V2 sea un detector adecuado para producción.
