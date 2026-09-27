# Proveedor browser de video para benchmark

## Objetivo

Permitir ejecutar el corpus anotado sobre un video local sin cargar todos los frames en memoria y sin subir el medio a un backend.

## Dos líneas de tiempo

Cada frame puede tener dos tiempos distintos:

- `timestampMs`: tiempo lógico que Konta2r entrega al `Detector` y conserva en el benchmark;
- `mediaTimeMs`: posición dentro del archivo de video usada para seek.

No deben inferirse uno desde el otro. Esto permite que un corpus use timestamps experimentales, relativos o absolutos sin confundirlos con el timeline del archivo.

## Fuente de frame

`BrowserVideoBenchmarkFrameProvider` reutiliza un único `HTMLVideoElement` como `CanvasImageSource`.

No crea por defecto:

- canvas por frame;
- `ImageBitmap` por frame;
- copia persistente del video;
- caché de imágenes del corpus.

El runner streaming no solicita el siguiente frame hasta que `Detector.detect()` termina, por lo que el elemento de video no cambia mientras el detector consume la fuente.

## Seek y evidencia temporal

`HTMLVideoElement.currentTime` es el mecanismo de seek, pero no se considera evidencia suficiente del tiempo del frame efectivamente presentado.

Cuando está disponible, Konta2r usa `requestVideoFrameCallback()` y su `mediaTime` para registrar:

- `actualMediaTimeMs`;
- `seekErrorMs = actualMediaTimeMs - mediaTimeMs`.

El resultado agrega:

- cantidad de frames con evidencia temporal;
- error absoluto medio;
- error absoluto máximo.

## Modo estricto

Con `requirePresentedFrameTime=true`, una corrida falla si el navegador no entrega tiempo del frame presentado.

Con `seekToleranceMs`, una corrida falla si el frame observado se aleja del tiempo anotado más de la tolerancia permitida.

Para resultados destinados a publicación o selección final de modelo se recomienda usar modo estricto y declarar la tolerancia utilizada.

## Dimensiones

Por defecto, las dimensiones nativas del video deben coincidir exactamente con `width` y `height` de la anotación. Las bounding boxes están definidas en píxeles del medio anotado; escalar silenciosamente el video invalidaría el ground truth.

## Privacidad

El proveedor trabaja con un `HTMLVideoElement` local. El video:

- no se incorpora al reporte;
- no se envía a Konta2r Community;
- no se sincroniza;
- no se convierte en identificadores de personas o vehículos.

El reporte conserva únicamente métricas, identidad/hash del corpus cuando exista y metadatos técnicos necesarios para reproducir la corrida.
