# Verificación técnica de probes ONNX

## Propósito

Definir cuándo un diagnóstico ONNX es evidencia técnica suficiente para **proponer** el cambio de un candidato desde `probe_pending` a `probe_verified`.

`probe_verified` significa únicamente que Konta2r observó un artefacto cuya identidad y contrato de entrada/salida son compatibles con el codec registrado. No significa que:

- el modelo tenga precisión suficiente;
- su rendimiento sea adecuado para un perfil Edge;
- sus pesos puedan redistribuirse;
- el modelo haya sido seleccionado para producción.

Esos gates se mantienen separados.

## Flujo de campo

1. Abrir Konta2r con `?diagnostics=onnx` en un navegador compatible.
2. Seleccionar el candidato registrado.
3. Iniciar manualmente la descarga del checkpoint externo.
4. Konta2r verifica el SHA-256 antes de entregar los bytes a ONNX Runtime.
5. El probe crea una sesión temporal y observa metadata real de inputs/outputs.
6. La aplicación recalcula compatibilidad con el codec declarado por el candidato.
7. Guardar el diagnóstico JSON completo.
8. Revisar el diagnóstico con `verifyCandidateProbeDiagnostic()`.
9. Si el resultado es `verified`, archivar el JSON como evidencia y proponer en un PR el cambio del registro a `probe_verified`.
10. El PR debe conservar separados el estatus técnico del probe, el gate de licencia y los resultados de benchmark.

La interfaz nunca cambia automáticamente el estado del candidato.

## Criterios para `verified`

El verificador exige simultáneamente:

- `candidateId` consistente entre registro, probe y assessment;
- URL del artefacto idéntica a la registrada;
- SHA-256 idéntico al registrado;
- metadata `complete`;
- codec asignado y evaluable;
- compatibilidad recalculada desde la metadata primaria;
- assessment almacenado idéntico al assessment recalculado;
- confirmación positiva del hint de dimensiones cuando el candidato declara uno.

El resultado contiene tres estados:

### `verified`

No existen hallazgos. El diagnóstico es técnicamente suficiente para proponer `probe_verified`.

### `incomplete`

La evidencia no contradice el registro, pero no basta para verificarlo. Ejemplos:

- metadata `names_only` o `partial`;
- no existe aún un codec registrado para esa familia;
- no puede confirmarse el input esperado.

La ausencia de metadata suficiente **no se interpreta como prueba de incompatibilidad**.

### `rejected`

Existe una contradicción material. Ejemplos:

- hash diferente;
- URL diferente;
- identidad de candidato diferente;
- contrato completo incompatible con el codec;
- assessment derivado guardado que no coincide con el recalculado desde la evidencia primaria.

## Evidencia primaria y derivada

El JSON de diagnóstico conserva dos niveles:

```text
probe primario
  ├─ identidad del artefacto
  ├─ runtime
  ├─ inputs observados
  └─ outputs observados

assessment derivado
  └─ compatibilidad con codec
```

El gate **no confía** en el assessment derivado. Lo vuelve a calcular desde inputs/outputs y comprueba que ambos resultados coincidan.

## Limitación de autenticidad

El diagnóstico JSON no contiene actualmente una firma criptográfica del nodo o del servidor. Por tanto, el gate verifica consistencia y trazabilidad del contenido, pero no puede demostrar por sí solo que un tercero no fabricó manualmente un JSON coherente.

Consecuencias:

- `probe_verified` no debe actualizarse automáticamente desde un archivo local;
- el diagnóstico debe conservarse en control de versiones o como artefacto del proceso de revisión;
- el cambio de estado debe ocurrir mediante PR revisable;
- una futura versión puede añadir una atestación firmada del probe, pero no es requisito para el primer piloto experimental.

## Separación de gates

```text
SHA-256 + probe IO
        ↓
probe_verified
        ↓
benchmark válido y reproducible
        ↓
calidad suficiente por clase / modo / dispositivo
        ↓
revisión de licencia y redistribución
        ↓
selección por perfil eco / balanced / performance
```

El orden puede incluir iteraciones, pero ninguna capa debe inferirse automáticamente de otra.

## Evidencia mínima a archivar

Para cada candidato que alcance `probe_verified` se recomienda conservar:

- diagnóstico JSON completo;
- fecha/hora del probe;
- SHA-256 del checkpoint;
- versión de ONNX Runtime Web;
- backend usado para crear la sesión temporal;
- inputs/outputs observados;
- resultado del gate técnico;
- referencia al PR que cambió el estado del candidato.

No se archiva video, frame de cámara, rostro, matrícula ni información de ubicación para verificar el contrato ONNX.
