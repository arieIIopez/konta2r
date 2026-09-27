# Reconstrucción espacial anónima y visualización 3D

## Propósito

Konta2r incorporará una capa de reconstrucción espacial inspirada en TrafficLab-3D para transformar trayectorias observadas en coordenadas de imagen en trayectorias sobre un plano calibrado y, cuando la calidad geométrica lo permita, en una representación 3D simplificada.

El objetivo no es crear una réplica visual de personas o vehículos. El objetivo es mejorar la interpretación de los datos de movilidad conservando anonimicidad por diseño.

TrafficLab-3D demuestra una cadena útil de conceptos: corrección de distorsión, homografía CCTV↔plano, corrección de paralaje, estimación de punto de contacto con el suelo, rumbo, velocidad y construcción de una huella espacial/volumen 3D. Konta2r reutilizará esos principios, pero desacoplados de su pipeline original y adaptados a procesamiento local en teléfonos.

## Principio de privacidad

La visualización espacial debe construirse desde **metadatos geométricos**, no desde apariencia visual.

El flujo objetivo es:

```text
video local
  ↓
detector
  ↓
fusión modal
  ↓
tracker local
  ↓
punto de contacto con suelo
  ↓
proyección imagen → plano calibrado
  ↓
cinemática / eventos espaciales
  ↓
representación anónima
  ├─ avatar geométrico local 2D/3D
  ├─ trayectoria temporal
  ├─ rumbo
  ├─ velocidad calibrada
  └─ ocupación espacial
  ↓
agregación / sincronización
```

Nunca es necesario para esta capa transmitir:

- imagen o video original;
- recortes de detección;
- rostro;
- matrícula;
- embedding visual;
- descriptor biométrico;
- color de ropa;
- marca/modelo/color real de un vehículo;
- identificador persistente entre cámaras.

## Qué se toma de TrafficLab-3D

### 1. Calibración de cámara

La calibración se divide conceptualmente en:

- intrínsecos de cámara;
- coeficientes de distorsión;
- homografía entre plano observado y plano cartográfico/local;
- altura/posición aproximada de la cámara;
- escala métrica;
- validación de puntos de control.

Esto permite convertir un punto observado `(u,v)` a una posición `(x,y)` sobre el plano de movilidad.

### 2. Corrección de paralaje

TrafficLab-3D corrige la diferencia entre la proyección aparente y la posición real en suelo usando altura de cámara y altura aproximada del objeto. En Konta2r este mecanismo puede ser útil, pero debe tratarse como una estimación con incertidumbre.

Para peatones, ciclistas y vehículos se utilizarán dimensiones **genéricas por categoría modal**, nunca dimensiones inferidas para identificar un individuo concreto.

### 3. Cinemática

A partir de una secuencia de posiciones métricas se pueden estimar:

- distancia recorrida;
- dirección/rumbo;
- velocidad;
- aceleración, solo cuando la resolución temporal y geométrica la hagan defendible;
- tiempo de permanencia;
- densidad y ocupación espacial.

Toda magnitud física debe incorporar `calibrationQuality` y no publicarse como velocidad real si el nodo no supera un umbral de calibración.

### 4. Representación 3D

La idea de `floor box` y caja 3D se conservará como representación analítica, pero se transformará en **avatares abstractos**.

Ejemplos:

- peatón → cápsula/cilindro simple;
- ciclista → prisma o pictograma simplificado;
- motociclista → prisma compacto;
- automóvil → bloque genérico;
- bus → bloque alargado;
- camión → bloque genérico pesado.

No se representará color, patente, marca, rostro, vestuario ni rasgos reales.

## Dominios espaciales

Konta2r distinguirá explícitamente:

1. `image`: coordenadas de píxel del dispositivo;
2. `local_ground`: plano cartesiano local métrico del nodo;
3. `analysis_map`: geometría del segmento vial usada para análisis;
4. `public_map`: geometría generalizada que puede compartirse públicamente.

La ubicación del domicilio del contribuyente no es necesaria para renderizar el flujo sobre el segmento observado.

## Contrato de trayectoria espacial anónima

Una muestra espacial destinada al renderizador puede tomar esta forma:

```json
{
  "schemaVersion": "2.0",
  "sessionId": "session_xxx",
  "renderTrackId": "r_8f31",
  "timestampMs": 1788123456789,
  "entityType": "cyclist",
  "position": { "xMeters": 14.2, "yMeters": 3.8 },
  "headingDegrees": 91.4,
  "speedMps": 4.7,
  "confidence": 0.93,
  "calibrationQuality": 0.88,
  "motionQuality": 0.90
}
```

`renderTrackId` debe ser efímero y válido únicamente dentro de una sesión/nodo. El backend no deberá intentar asociarlo con tracks de otro nodo.

## Tres niveles de visualización

### Nivel 1 — Edge/local

En el teléfono del contribuyente se puede mostrar:

- cámara original en vivo;
- detecciones y tracks;
- plano reconstruido;
- avatares 2D/3D;
- líneas/zonas;
- métricas de calibración.

La imagen permanece local.

### Nivel 2 — Dashboard privado del nodo

El propietario puede ver un replay reconstruido sin video:

- geometría de la calle;
- avatares abstractos;
- trayectorias;
- velocidades;
- conteos;
- ocupación;
- zonas de permanencia.

### Nivel 3 — Konta2r Commons

La capa pública debe privilegiar agregados:

- flow ribbons por sentido;
- mapas de calor;
- trayectorias agregadas;
- distribución de velocidades;
- ocupación por celda;
- densidad temporal;
- animaciones sintéticas construidas desde intervalos agregados.

No debe exponerse una secuencia de alta resolución temporal cuando pueda facilitar seguimiento de un individuo a través del espacio.

## Modos de privacidad temporal

Se proponen tres políticas:

- `local_realtime`: tracks individuales visibles solo en el dispositivo;
- `private_replay`: tracks efímeros disponibles al propietario/investigador autorizado dentro de un nodo y sesión;
- `public_aggregate`: sin tracks individuales; solo agregados temporales/espaciales.

## Calibración adaptada a teléfonos en ventanas

La calibración de TrafficLab-3D requiere actualmente varios pasos manuales. Para una red ciudadana Konta2r deberá simplificarlos.

Flujo objetivo:

1. detectar intrínsecos aproximados desde metadatos/cámara cuando sea posible;
2. permitir corrección visual de distorsión solo si es necesaria;
3. mostrar mapa/ortofoto o geometría OSM del segmento observado;
4. solicitar 4–8 correspondencias visibles entre imagen y mapa;
5. calcular homografía con RANSAC;
6. pedir una distancia conocida o inferir escala desde geometría cartográfica;
7. estimar altura de cámara mediante asistente;
8. validar sobre puntos no usados en el ajuste;
9. producir error reproyectado y `calibrationQuality`;
10. deshabilitar velocidad métrica si el error supera el umbral.

Para nodos de baja capacidad se permitirá un modo `count-only` sin reconstrucción métrica.

## Incertidumbre y validez

Una transformación geométrica visualmente atractiva puede ser incorrecta. Konta2r debe separar claramente:

- `visualizationConfidence`;
- `positionErrorMeters` estimado;
- `calibrationQuality`;
- `trackingQuality`;
- `speedQuality`.

La calidad del dato no debe inferirse de cuán convincente se ve el gemelo digital.

### Métricas de calibración propuestas

- error de reproyección mediano y p95;
- error en puntos de validación independientes;
- cobertura del polígono calibrado;
- sensibilidad a pequeños cambios de los puntos de control;
- escala métrica residual;
- estabilidad temporal de la cámara;
- detección de desplazamiento posterior a la calibración.

## Detección de movimiento de cámara

Un teléfono apoyado en una ventana puede moverse. Una calibración antigua dejaría de ser válida aunque el detector siguiera funcionando.

El nodo debe mantener una firma geométrica local de elementos estáticos y detectar:

- cambio de orientación;
- desplazamiento físico;
- zoom digital;
- cambio de cámara/lente;
- alteración fuerte del encuadre.

Cuando se supere el umbral:

1. marcar calibración `stale`;
2. suspender velocidades métricas;
3. continuar conteo solo si la geometría de líneas sigue siendo válida o recalibrarlas;
4. solicitar recalibración al usuario.

## Productos analíticos habilitados

Con una calibración válida, Konta2r puede superar el conteo simple y producir:

- perfiles de velocidad por modo;
- trayectorias de aproximación a cruces;
- distribución lateral del uso de una ciclovía;
- invasión modal de espacios;
- ocupación de calzada/vereda/ciclovía;
- densidad espacial;
- tiempos de permanencia;
- giros y movimientos direccionales;
- conflictos aproximados y proximidad entre trayectorias, con metodología específica;
- aceleraciones/desaceleraciones donde la calidad temporal lo permita;
- mapas de calor de uso efectivo del espacio.

Estas variables deben considerarse derivadas y no confundirse con observaciones directas.

## Lo que no se importará del pipeline original

TrafficLab-3D utiliza actualmente un pipeline Python orientado a archivos MP4, modelos Ultralytics/YOLO, outputs `.json.gz` y una GUI de escritorio. Konta2r no debe incorporar ese pipeline completo porque:

- el nodo objetivo es un teléfono/navegador;
- la inferencia debe ser continua y local;
- detector y tracker deben permanecer intercambiables;
- la red comunitaria necesita contratos de datos propios;
- el video no debe ser requerido por el servidor;
- la reconstrucción espacial debe poder ejecutarse incrementalmente.

La integración será por principios y componentes matemáticos claramente aislados.

## Compatibilidad y atribución

TrafficLab-3D está publicado bajo licencia MIT. Si Konta2r incorpora código o porciones sustanciales de su implementación, deberá conservar el copyright y aviso MIT correspondientes en `THIRD_PARTY_NOTICES.md` y/o junto al componente derivado.

Referencia:

- TrafficLab-3D — Yuk / duy-phamduc68
- https://github.com/duy-phamduc68/TrafficLab-3D

## Secuencia de implementación

1. definir contratos espaciales y de privacidad;
2. implementar transformaciones 2D imagen↔plano con tests sintéticos;
3. implementar calibración por homografía y error de reproyección;
4. incorporar escala métrica;
5. integrar posición de tracks con `SpatialTrackSample`;
6. estimar rumbo/velocidad con suavizado explícito;
7. construir renderizador anónimo 2D;
8. añadir representación 3D abstracta;
9. incorporar detección de movimiento de cámara;
10. validar contra distancias/velocidades ground truth antes de habilitar métricas físicas en producción.
