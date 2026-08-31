# Protocolo de captura piloto para benchmark

## Propósito

El piloto empírico convierte la infraestructura de benchmark de Konta2r en evidencia de campo reproducible. Su objetivo no es recolectar video de forma continua ni construir un repositorio central de imágenes: usa clips locales, acotados y deliberadamente seleccionados para validar detección, fusión, tracking y desempeño del nodo.

La superficie `?diagnostics=pilot` genera un `PilotCaptureRecord` antes de la anotación. El registro documenta condiciones de observación, settings efectivos de cámara y capacidades generales del dispositivo sin almacenar domicilio, coordenadas precisas ni `deviceId` de cámara.

## Secuencia metodológica

1. Definir un `siteId` pseudónimo que represente el espacio observado, no el domicilio desde el que se observa.
2. Declarar `plannedSplit` **antes** de grabar: `development`, `validation` o `held_out_test`.
3. Declarar tipología, iluminación, ángulo, montaje, vidrio/reflejos, oclusión y estabilidad.
4. Seleccionar el perfil `eco`, `balanced` o `performance` antes de iniciar la cámara.
5. Iniciar cámara local y registrar los settings efectivos entregados por el navegador.
6. Grabar un clip local con audio deshabilitado. La superficie limita cada clip a 10 minutos para acotar memoria en dispositivos antiguos.
7. Al detener, calcular SHA-256 incremental del clip y asociarlo a la ficha.
8. Guardar localmente el video y el JSON de captura.
9. Anotar el clip con `?diagnostics=annotate` usando muestreo temporal reproducible.
10. Revisar la secuencia con `?diagnostics=corpus` y agregarla al `CorpusManifest` mediante `?diagnostics=manifest-build`.
11. Congelar splits antes de usar `held_out_test`.
12. Ejecutar selección en `validation` y reservar `held_out_test` para `final_evaluation`.

## Diseño inicial del piloto

Como primera campaña se recomienda trabajar con aproximadamente 10–30 dispositivos/sitios, priorizando diversidad efectiva antes que volumen bruto. La matriz debe combinar, en la medida en que la pregunta de validación lo requiera:

- perfiles de dispositivo `eco`, `balanced` y `performance`;
- ciclovías protegidas/no protegidas, tránsito mixto, intersecciones, aceras, corredores y espacios compartidos;
- día, contraluz, amanecer/atardecer, noche y condiciones mixtas;
- cámaras oblicuas bajas/medias/altas y vistas cercanas a cenital;
- escenas con objetos pequeños y parcialmente ocluidos;
- captura directa y a través de vidrio;
- reflejos bajos y altos;
- diferentes densidades de peatones, bicicletas, motos, automóviles, buses y camiones;
- alimentación por red y batería cuando se estudie estabilidad sostenida.

La lista es una guía de cobertura, no una cuota estadística universal. La suficiencia depende de qué afirmación se quiera sostener.

## Independencia de splits

`development` puede utilizarse para depurar el pipeline y aprender sobre fallos del sistema. `validation` sirve para comparar candidatos y tomar decisiones como thresholds. `held_out_test` no debe consultarse para esas decisiones.

Si un sitio del held-out fue observado anteriormente en development/validation, el resultado puede seguir midiendo generalización temporal o condicional, pero **no demuestra generalización espacial a un sitio/cámara nunca visto**. Esa dependencia debe permanecer visible en `?diagnostics=manifest`.

## Ground truth

Las anotaciones manuales deben realizarse sin convertir automáticamente la predicción del detector candidato en verdad de referencia. Si se usa preanotación en el futuro, debe quedar explícitamente documentada y someterse a revisión humana independiente.

Para el detector bruto, anotar clases observables (`person`, `bicycle`, `motorcycle`, etc.). La entidad `cyclist` corresponde a la etapa de fusión modal y debe validarse separadamente.

## Evidencia técnica por captura

`PilotCaptureRecord` conserva:

- `captureId` y `siteId` pseudónimos;
- split declarado antes de grabar;
- fecha/hora de inicio y duración medida de grabación;
- resolución, FPS, orientación, facing mode y tipo de montaje;
- perfil de nodo, concurrencia lógica, hint de memoria, WebGPU y fuente de energía;
- tipología, iluminación, ángulo, vidrio, reflejos, oclusión y estabilidad;
- SHA-256, tamaño y MIME del video local;
- notas de campo acotadas.

No conserva coordenadas precisas, domicilio, `deviceId`, audio ni bytes de video dentro del JSON.

## Revisión descriptiva

`reviewPilotCaptureRecord()` emite observaciones sobre clips cortos, baja resolución/FPS, captura handheld, estabilidad pobre, reflejos, oclusión, vidrio y batería. Estas observaciones **no producen score ni veredicto valid/invalid**. Una condición difícil puede ser precisamente la evidencia necesaria para un conjunto de validation bien diseñado.

## Privacidad y Community

Los clips de piloto son material local de validación y no forman parte del contrato de datos públicos de Konta2r Community. El diseño operativo sigue siendo: video local → eventos/agregados → sincronización, sin transferencia de video crudo por defecto.

## Criterio de avance

El detector no debe seleccionarse por compatibilidad técnica o popularidad. El avance hacia producción requiere al menos:

- corpus real congelado y trazable;
- precision/recall/F1 por clase y estratos relevantes;
- desempeño sostenido en perfiles de dispositivo;
- evidencia temporal y hashes reproducibles;
- comparación con al menos otro candidato razonable;
- revisión separada de licencia/redistribución;
- validación downstream de fusión, tracking y conteo.
