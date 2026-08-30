# Auditoría del prototipo `contador.html`

## Rol del prototipo

El archivo original se considera **baseline funcional**, no arquitectura objetivo. Su valor está en haber probado en terreno o en navegador una serie de capacidades que deben preservarse o reinterpretarse en v2.

## Capacidades que se conservan como requisitos

- acceso a cámara frontal/trasera;
- detección en tiempo real;
- contadores por categoría;
- línea de conteo configurable;
- registro de dirección;
- georreferenciación de sesión;
- persistencia local con IndexedDB;
- exportación CSV;
- fotografías y grabación de video para auditoría;
- zonas de permanencia;
- snapshots automáticos;
- observaciones complementarias de uso del espacio público;
- operación principalmente en el dispositivo.

## Problemas identificados

### A. Unidad estadística incorrecta

El prototipo transforma directamente clases COCO en categorías de movilidad. Una detección `person` se contabiliza como peatón y una `bicycle` como bicicleta, sin reconstruir la relación entre ambas. Un ciclista puede generar dos observaciones.

**Decisión v2:** crear una capa `entity fusion` entre detector y tracker/eventos.

### B. Tracking greedy

La asociación se basa principalmente en distancia entre centros e IoU, recorriendo tracks y seleccionando el mejor candidato disponible. Esto es vulnerable a cruces, oclusiones, grupos y cambios rápidos de escala.

**Decisión v2:** tracker independiente con asignación global, modelo de movimiento y estados de track.

### C. Cruce de línea como cambio de lado de una recta

La función del prototipo usa el producto cruzado para obtener lado, pero trata el resultado como si fuera distancia en píxeles. Además, el cruce se dispara al cambiar de lado de la recta infinita, sin exigir intersección con el segmento dibujado.

**Decisión v2:** intersección segmento–segmento + histéresis basada en distancia perpendicular normalizada.

### D. Parámetros temporales fijos

La edad del track y cooldown se expresan en milisegundos, lo que es correcto conceptualmente, pero la robustez depende fuertemente del FPS efectivo de inferencia y de la latencia del modelo.

**Decisión v2:** registrar FPS efectivo, latencia y discontinuidades; adaptar tolerancias a evidencia temporal.

### E. Detector con límite y modelo no versionado

El prototipo llama a COCO-SSD desde CDN y no fija explícitamente la versión del paquete del modelo. Además, la inferencia se ejecuta con parámetros por defecto del detector.

**Decisión v2:** dependencias versionadas; modelo identificado por versión/hash; configuración almacenada en el manifiesto de sesión.

### F. Esquema de datos insuficiente para auditoría

Los eventos guardan categoría, timestamp, dirección y ubicación, pero no contienen toda la información necesaria para reconstruir el origen de cada conteo.

**Decisión v2:** guardar `track_id`, detector, modelo, configuración, geometría, confidence, posición de cruce y versiones de componentes.

### G. Variables automáticas y manuales mezcladas

La capa de observación de permanencia incorpora actividad, postura, tamaño de grupo y notas desde campos globales de interfaz. Esas variables pueden terminar asociadas a un evento sin distinguir si fueron inferidas o codificadas manualmente.

**Decisión v2:** separar `machine_observation` de `observer_annotation`, con autor/origen explícito.

### H. Migraciones IndexedDB

La evolución del esquema requiere versionado estricto. Si se agregan object stores sin elevar versión, una base existente puede quedar inconsistente.

**Decisión v2:** migraciones numeradas y tests de upgrade.

## Qué NO se trasladará literalmente

- archivo HTML monolítico;
- variables globales de estado;
- lógica de negocio acoplada al canvas;
- dependencia directa de clases COCO en los contadores;
- reglas espaciales sin tests;
- configuración implícita;
- CDN sin versionado reproducible.

## Criterio de compatibilidad

La v2 no necesita producir exactamente los mismos conteos que el prototipo. De hecho, una diferencia será esperable cuando el prototipo haya generado dobles conteos o identidades fragmentadas.

La compatibilidad relevante será funcional: poder realizar las mismas tareas de observación con mayor trazabilidad, validez y robustez.
