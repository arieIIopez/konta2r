# Metodología de medición

## Propósito

Este documento define qué significa una observación válida en Konta2r. La plataforma no debe asumir que la salida del detector equivale directamente a flujo, modo, actividad, interacción o permanencia. Konta2r distingue explícitamente entre **entidades observadas**, **relaciones observables**, **episodios temporales** e **interpretaciones analíticas**.

## 1. Unidad de observación

La unidad básica del pipeline de movilidad es una **entidad persistente en el tiempo**. Para Public Life se agregan dos unidades complementarias: una **relación observable persistente** entre entidades/elementos y un **episodio de actividad** delimitado temporal y espacialmente.

Una entidad puede estar compuesta por una o más detecciones del modelo. Por ejemplo, una persona asociada de manera persistente con una bicicleta puede producir una entidad `cyclist`, no dos observaciones independientes `pedestrian` y `bicycle`.

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

## 5. Vida pública, relaciones y actividad observable

Konta2r incorpora una línea de observación de vida pública inspirada en Public Space / Public Life (PSPL), documentada en `docs/public-life-gehl.md`.

Las preguntas operativas son:

- **cuántos:** presencia, flujo y permanencia;
- **quiénes:** categorías observables autorizadas por el protocolo, nunca identidad personal;
- **dónde:** zona, posición, concentración y relación con elementos urbanos;
- **qué hacen:** comportamientos visualmente observables;
- **con quién o con qué:** relaciones persona–persona, persona–objeto y persona–elemento urbano;
- **cuánto tiempo:** persistencia, permanencia y duración de episodios.

Konta2r no debe traducir automáticamente una observación en una motivación. Por ejemplo, `sitting_on(bench)` es una observación; “descansando” es una interpretación. `standing` durante ocho minutos es observable; “esperando” requiere una regla o evidencia adicional.

### Relaciones

Toda relación automática deberá conservar:

- endpoints/entidades involucradas;
- predicado observado;
- score;
- proveedor/modelo y versión;
- timestamps;
- estado de evaluabilidad de los endpoints;
- persistencia temporal;
- geometría o elemento semántico asociado;
- configuración/hash de la sesión.

### Episodios

Un episodio agrega relaciones y estados de track en el tiempo. Debe tolerar oclusiones breves sin confundir “no observable” con “relación observada negativamente”.

### Categorías humanas

La inferencia automática no debe intentar identificar personas ni inferir atributos sensibles. Cuando una investigación requiera categorías humanas adicionales, deben definirse explícitamente en el protocolo y validarse; las codificaciones manuales deben permanecer diferenciadas de las inferencias automáticas.

### Validación Public Life

El ground truth deberá medir, según el caso:

- postura/actividad observable;
- uso real vs proximidad a mobiliario;
- relaciones sociales observables;
- duración de actividad;
- inicio/fin de episodios;
- bicicleta montada vs caminada;
- falsos vínculos causados por proximidad espacial.

Las métricas por relación/actividad deben reportarse separadamente y también por su impacto sobre indicadores agregados.

## 6. Dirección

La dirección debe derivarse de la geometría y la trayectoria, no de etiquetas arbitrarias desconectadas del espacio.

Para cada línea se podrán definir nombres semánticos, por ejemplo:

```text
A→B = norte
B→A = sur
```

La base de datos conservará tanto el sentido geométrico como la etiqueta semántica.

## 7. Velocidad

No se reportará velocidad en km/h a partir de distancias de píxeles.

La velocidad métrica solo se habilitará cuando exista una transformación calibrada imagen→plano de suelo, mediante homografía u otro método con error documentado.

Sin calibración se podrán usar variables relativas de movimiento, pero deberán denominarse explícitamente como tales.

## 8. Incertidumbre

Cada evento deberá conservar medidas que permitan estimar incertidumbre:

- confianza del detector;
- edad y estabilidad del track;
- número de detecciones asociadas;
- discontinuidades/oclusiones;
- confianza de asociación modal;
- precisión de calibración, si existe;
- FPS efectivo de inferencia.

En versiones posteriores se podrá construir un `event_confidence` separado de la confianza del detector.

## 9. Validación

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

## 10. Métricas

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

### Vida pública / relaciones

- precision/recall/F1 por predicado observable;
- matriz de confusión de actividades observables;
- error de duración de episodios;
- fragmentación temporal de relaciones;
- falsos usos de mobiliario;
- falsos grupos/interacciones;
- error de indicadores agregados derivados.

## 11. Reproducibilidad de una sesión

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
- versión del esquema de datos;
- versión del vocabulario de relaciones Public Life, si se utiliza;
- proveedor/modelo relacional y hash del artefacto, si corresponde;
- versión del mapa semántico del espacio público.

El manifiesto deberá exportarse junto con los eventos, relaciones y episodios.
