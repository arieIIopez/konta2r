# Metodología de medición

## Propósito

Este documento define qué significa una observación válida en Konta2r. La plataforma no debe asumir que la salida del detector equivale directamente a flujo, modo o permanencia.

## 1. Unidad de observación

La unidad básica es una **entidad de movilidad persistente en el tiempo**.

Una entidad puede estar compuesta por una o más detecciones del modelo. Por ejemplo, una persona asociada de manera persistente con una bicicleta debe producir una entidad `cyclist`, no dos observaciones independientes `pedestrian` y `bicycle`.

## 2. Estados de una entidad

Un track deberá transitar por estados explícitos:

```text
tentative → confirmed → lost → removed
                    ↘ recovered
```

Solo tracks confirmados pueden generar eventos de conteo. La recuperación de un track perdido debe conservar su ID cuando la evidencia de asociación sea suficiente.

## 3. Conteo por línea

Una línea de conteo es un **segmento finito orientado A→B**.

Un evento se produce cuando el segmento formado por dos posiciones consecutivas y válidas del track intersecta geométricamente el segmento de conteo y satisface las condiciones de histéresis y estabilidad.

No constituye cruce:

- cambiar de lado respecto de la recta infinita fuera de los extremos del segmento;
- oscilar alrededor de la línea por ruido de detección;
- aparecer por primera vez al otro lado de la línea;
- reidentificarse inmediatamente después de una oclusión sin evidencia suficiente de trayectoria.

Cada evento debe conservar la posición interpolada de cruce y la dirección.

## 4. Zonas y permanencia

Una zona deberá modelarse preferentemente como polígono, no solo como rectángulo.

La entrada y salida se determinarán con un punto representativo de suelo (`ground_point`). En detección 2D este punto será inicialmente el centro inferior de la caja; cuando exista pose o segmentación podrá definirse una mejor estimación.

La permanencia se calcula con timestamps reales, no por número de frames.

Se deberán diferenciar:

- **presencia:** entidad visible dentro de la zona;
- **permanencia:** intervalo continuo o recuperado de presencia;
- **actividad:** interpretación adicional, automática o codificada por observador.

La actividad humana manual nunca deberá almacenarse como si hubiera sido inferida automáticamente.

## 5. Dirección

La dirección debe derivarse de la geometría y la trayectoria, no de etiquetas arbitrarias desconectadas del espacio.

Para cada línea se podrán definir nombres semánticos, por ejemplo:

```text
A→B = norte
B→A = sur
```

La base de datos conservará tanto el sentido geométrico como la etiqueta semántica.

## 6. Velocidad

No se reportará velocidad en km/h a partir de distancias de píxeles.

La velocidad métrica solo se habilitará cuando exista una transformación calibrada imagen→plano de suelo, mediante homografía u otro método con error documentado.

Sin calibración se podrán usar variables relativas de movimiento, pero deberán denominarse explícitamente como tales.

## 7. Incertidumbre

Cada evento deberá conservar medidas que permitan estimar incertidumbre:

- confianza del detector;
- edad y estabilidad del track;
- número de detecciones asociadas;
- discontinuidades/oclusiones;
- confianza de asociación modal;
- precisión de calibración, si existe;
- FPS efectivo de inferencia.

En versiones posteriores se podrá construir un `event_confidence` separado de la confianza del detector.

## 8. Validación

Toda versión destinada a levantamientos deberá validarse contra observación manual independiente.

El conjunto mínimo de prueba deberá cubrir:

- baja y alta densidad;
- día y noche;
- contraluz;
- lluvia o condiciones adversas cuando sea pertinente;
- peatones individuales y grupos;
- ciclistas montados y caminando con bicicleta;
- motocicletas y bicicletas próximas;
- buses/camiones con oclusión de objetos menores;
- cruces simultáneos en sentidos opuestos.

Los resultados se informarán por categoría y escenario. No se aceptará una única tasa global como evidencia suficiente de desempeño.

## 9. Métricas

### Detección

- precision;
- recall;
- F1;
- AP por clase cuando exista ground truth de cajas.

### Tracking

- IDF1;
- HOTA cuando sea viable;
- identity switches;
- fragmentaciones;
- duración de tracks recuperados.

### Conteo

- error absoluto por categoría y dirección;
- error relativo para muestras con denominadores adecuados;
- falsos cruces;
- cruces omitidos.

### Permanencia

- error absoluto de duración;
- sesgo medio;
- errores de entrada/salida de zona.

## 10. Reproducibilidad de una sesión

Cada sesión deberá guardar un manifiesto con:

- versión de Konta2r;
- versión/hash del modelo;
- runtime y backend;
- parámetros de detección;
- parámetros del tracker;
- geometrías;
- resolución y orientación;
- información temporal;
- estado de calibración;
- versión del esquema de datos.

El manifiesto deberá exportarse junto con los eventos.
