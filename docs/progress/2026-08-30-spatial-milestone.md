# Hito de reconstrucción espacial — 30 de agosto de 2026

## Alcance

Este hito convierte la integración conceptual de TrafficLab-3D en componentes nativos de Konta2r v2 orientados a ejecución Edge en navegador/teléfono y privacidad por diseño.

No se ha importado el pipeline Python/YOLO/Qt de TrafficLab-3D. Se reutilizan principios geométricos y se mantiene atribución MIT en `THIRD_PARTY_NOTICES.md`.

## Componentes implementados

### Proyección espacial

- homografía imagen ↔ plano;
- inversa 3×3;
- Brown–Conrady radial/tangencial;
- undistorsión iterativa;
- corrección de paralaje inspirada en `GProjection`;
- conversión explícita a metros.

### Calibración robusta

- cuatro o más correspondencias imagen/plano;
- ajuste por mínimos cuadrados;
- RANSAC determinista para conjuntos pequeños;
- máscara de inliers;
- error mediano y p95 en metros;
- `calibrationQuality`;
- diagnóstico de distribución espacial de puntos;
- instrucciones de calibración para usuario no técnico.

### Política de capacidades

Las métricas se habilitan según evidencia, no según disponibilidad de interfaz.

Niveles actuales:

1. `counting`;
2. `direction`;
3. `approximate_trajectory`;
4. `metric_position`;
5. `metric_speed`;
6. `advanced_interactions`.

Una mala calibración no impide necesariamente contar, pero sí bloquea magnitudes físicas.

### Estabilidad de cámara

Se incorporó un guard basado en anclas estáticas locales que detecta:

- desplazamiento del teléfono;
- deriva del encuadre;
- cambio de zoom/escala;
- evidencia insuficiente para asegurar estabilidad.

El módulo solo requiere coordenadas de anclas. La extracción visual permanece local y no forma parte del contrato de sincronización.

### Cinemática

Existe un estimador robusto para trayectoria métrica con:

- velocidad por segmentos temporales;
- mediana robusta;
- rumbo;
- rechazo de saltos físicamente inverosímiles;
- `motionQuality`.

Aceleración y métricas de conflicto no se habilitan todavía como productos válidos.

### Synthetic Twin 2D

Se implementó un renderer Canvas que recibe únicamente:

- categoría modal;
- posición métrica;
- rumbo opcional;
- velocidad opcional;
- confianza/calidad;
- identificador efímero local.

No existe en su contrato:

- imagen;
- video;
- rostro;
- matrícula;
- color/vestimenta;
- marca/modelo real;
- embedding visual.

### Agregación para Konta2r Commons

Los tracks privados pueden reducirse a celdas espacio-temporales públicas con:

- intervalo;
- celda;
- modo;
- cantidad de entidades;
- número de muestras;
- velocidad media cuando sea válida;
- calidad media.

Los IDs individuales se usan transitoriamente para deduplicación local y no se incluyen en la salida pública. Se incorpora un umbral mínimo de entidades por celda/intervalo.

## Browser shell v2

La rama contiene ahora un `index.html` y una interfaz responsive que permiten visualizar el Synthetic Twin y la política de capacidades.

El modo actual usa datos sintéticos deliberadamente. No se presenta como detector real. Sirve para probar:

- renderizado en teléfonos;
- estados de calidad;
- suspensión de métricas cuando la cámara se mueve;
- comunicación de incertidumbre;
- arquitectura de UI separada de la cámara.

## CI

GitHub Actions valida:

1. TypeScript estricto;
2. tests unitarios;
3. build web de producción.

## Decisiones metodológicas fijadas

1. Una visualización convincente no constituye evidencia de precisión.
2. La velocidad se publica solo con posición métrica válida y error geométrico bajo.
3. Un movimiento de cámara invalida magnitudes físicas hasta recalibrar.
4. El video permanece local por defecto.
5. Los IDs de tracks no pueden conectarse entre nodos.
6. La capa pública privilegia agregados espacio-temporales.
7. Las dimensiones de los avatares son genéricas por categoría y no atributos observados del individuo.

## Siguiente hito

El siguiente núcleo técnico es el tracker multiobjeto v2. Debe entregar identidades temporales suficientemente estables para que la reconstrucción espacial, conteos y permanencias no hereden fragmentaciones del tracker legacy.

Objetivos inmediatos:

- modelo de movimiento de velocidad constante;
- estados `tentative/confirmed/lost/removed`;
- matriz de costos con distancia, IoU y dinámica;
- asignación global;
- asociación en dos etapas para detecciones de distinta confianza;
- recuperación tras oclusión breve;
- tests sintéticos de cruces y oclusiones;
- métricas de fragmentación e ID switches.
