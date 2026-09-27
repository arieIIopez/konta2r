# Konta2r como red comunitaria de sensores de movilidad

## Propósito

Konta2r debe evolucionar desde una herramienta individual de conteo hacia una infraestructura distribuida de ciencia ciudadana capaz de transformar teléfonos en desuso en nodos de observación de movilidad.

La hipótesis del sistema es simple: miles de ventanas, balcones, comercios, organizaciones y equipamientos públicos pueden constituir una red de observación mucho más densa que una campaña tradicional de aforos, siempre que el dato sea comparable, auditable, privado y acompañado por una estimación explícita de su calidad.

El objetivo no es recolectar video a escala urbana. El objetivo es procesar imágenes localmente y compartir eventos y agregados anonimizados.

## Principios

1. **Procesamiento local por defecto.** El video permanece en el dispositivo. El servidor recibe eventos, métricas agregadas y metadatos mínimos de calidad.
2. **Privacidad por diseño.** Ninguna identidad, rostro, matrícula ni audio es necesario para el producto estadístico.
3. **Datos abiertos, observación responsable.** Los resultados agregados pueden ser públicos; el material visual original no debe serlo por defecto.
4. **Trazabilidad.** Cada dato debe indicar versión de software/modelo, configuración, calidad estimada, ubicación y período de observación.
5. **Calidad explícita.** Un conteo comunitario no se presenta como verdad. Cada nodo y período tendrá indicadores de confiabilidad.
6. **Comparabilidad.** Una observación debe utilizar taxonomías, intervalos y geometrías normalizadas.
7. **Hardware reutilizado.** El sistema debe degradar funcionalmente según capacidades del dispositivo en vez de excluir teléfonos antiguos.
8. **Comunidad antes que plataforma.** Los participantes deben poder ver qué aportaron y qué conocimiento colectivo produjo su contribución.

## Arquitectura objetivo

```text
cámara
  ↓
Konta2r Edge Node
  ├─ captura
  ├─ detector
  ├─ fusión modal
  ├─ tracking
  ├─ eventos espaciales
  ├─ agregación temporal
  ├─ quality metrics
  └─ cola local/offline
          ↓ HTTPS
Konta2r Community API
  ├─ autenticación de nodo
  ├─ validación de esquemas
  ├─ ingestión
  ├─ control de calidad
  ├─ deduplicación
  ├─ agregación espacial/temporal
  └─ almacenamiento
          ↓
Konta2r Commons
  ├─ mapa de sensores
  ├─ series de flujos
  ├─ API abierta
  ├─ descarga de datos
  ├─ panel del contribuyente
  └─ herramientas de validación comunitaria
```

## El teléfono como Edge Node

Cada teléfono funciona como un nodo autónomo. Debe poder operar conectado permanentemente a energía y Wi-Fi, con la cámara orientada hacia una sección de calle, vereda, ciclovía o espacio público.

### Perfil automático del dispositivo

En el primer inicio el nodo ejecutará un benchmark corto y seleccionará una configuración:

- `eco`: CPU/WASM, resolución baja, inferencia espaciada;
- `balanced`: WASM SIMD/threads o GPU compatible;
- `performance`: WebGPU y modelo de mayor capacidad.

El objetivo no es mantener un FPS fijo. Para conteo importa conservar suficiente resolución temporal para seguir las trayectorias relevantes.

### Operación continua

El nodo debe registrar:

- uptime;
- FPS de video e inferencia;
- latencia p50/p95;
- temperatura/thermal throttling cuando el sistema operativo lo permita;
- memoria disponible indirecta o fallas por presión;
- pérdida de frames;
- cambios de orientación o encuadre;
- interrupciones de energía/conectividad;
- versión de modelo y configuración.

Una PWA puede servir como primera implementación porque simplifica instalación y actualización. Sin embargo, la captura de cámara debe permanecer en primer plano y los navegadores restringen el trabajo arbitrario en background. Para nodos permanentes habrá que evaluar una aplicación Android ligera o wrapper nativo si las pruebas muestran que la PWA no mantiene estabilidad suficiente en teléfonos antiguos.

## Alta de un nodo

El flujo debe ser comprensible para una persona sin conocimientos técnicos:

1. instalar/abrir Konta2r;
2. iniciar sesión o crear identidad comunitaria opcional;
3. registrar el dispositivo;
4. autorizar cámara y ubicación;
5. colocar el teléfono mirando hacia la calle;
6. definir área observable;
7. dibujar una o más líneas de conteo y sentidos;
8. ejecutar calibración asistida;
9. realizar período corto de prueba;
10. obtener un `Node Quality Score`;
11. comenzar a contribuir.

La ubicación pública no debe necesariamente corresponder al punto exacto del domicilio. El backend debe mantener coordenadas precisas bajo acceso restringido cuando sean necesarias para análisis espacial y publicar coordenadas desplazadas, centroides de celda o agregaciones espaciales según la política de privacidad.

## Calibración asistida

El principal riesgo de una red ciudadana no será solamente el modelo de IA, sino la heterogeneidad del montaje.

El asistente de calibración debe evaluar:

- altura aproximada;
- ángulo de cámara;
- porción del espacio observable;
- tamaño mínimo de usuarios en píxeles;
- oclusiones permanentes;
- reflejos de vidrio;
- contraluz;
- porcentaje de imagen útil;
- vibración;
- estabilidad del encuadre;
- densidad máxima observable.

Debe advertir cuando una ubicación sirve para peatones pero no vehículos, o viceversa.

## Datos transmitidos

### Por evento

Un evento puede contener:

```json
{
  "schemaVersion": "2.0",
  "nodeId": "node_xxx",
  "sessionId": "session_xxx",
  "eventId": "event_xxx",
  "timestamp": "ISO-8601",
  "entityType": "cyclist",
  "eventType": "line_crossing",
  "geometryId": "line_1",
  "direction": "A_TO_B",
  "confidence": 0.91,
  "qualityScore": 0.87,
  "softwareVersion": "...",
  "modelVersion": "..."
}
```

No requiere imagen.

### Agregación recomendada para datos públicos

Para la capa abierta conviene publicar preferentemente agregados de 5 o 15 minutos:

- período;
- celda espacial o segmento;
- clase modal;
- sentido;
- flujo;
- número de nodos contribuyentes;
- cobertura temporal;
- score de calidad;
- versión metodológica.

Esto reduce riesgos de privacidad y hace el dato más útil para análisis de transporte.

## Node Quality Score

La red necesita distinguir cantidad de datos de calidad de datos. El score no debe ser una cifra opaca; debe descomponerse.

Dimensiones iniciales:

- `Q_geometry`: calidad del encuadre y geometría;
- `Q_detection`: condiciones que afectan detección;
- `Q_tracking`: continuidad observada de tracks;
- `Q_temporal`: continuidad del período;
- `Q_device`: estabilidad computacional;
- `Q_validation`: acuerdo con muestras validadas;
- `Q_consistency`: consistencia temporal respecto del propio nodo y nodos cercanos.

El score agregado servirá para ponderar observaciones, nunca para ocultar incertidumbre.

## Validación comunitaria

La comunidad puede mejorar el sistema sin compartir video continuo.

Modos posibles:

- solicitud voluntaria de snapshots anonimizados;
- clips breves únicamente para campañas explícitas de validación;
- conteo manual paralelo de 5–10 minutos;
- comparación entre dos nodos cercanos;
- campañas coordinadas de ground truth;
- etiquetado de escenas difíciles.

Toda captura visual para validación debe ser opt-in, temporalmente limitada y sometida a anonimización cuando corresponda.

## Confianza y reputación

No asumir que todo nodo es equivalente. El sistema debe detectar:

- nodos duplicados;
- eventos artificiales;
- cámaras movidas;
- configuraciones imposibles;
- relojes incorrectos;
- series excesivamente repetitivas;
- cambios abruptos incompatibles con nodos vecinos;
- versiones obsoletas con errores conocidos.

La reputación debe basarse principalmente en evidencia técnica del nodo y su historial de validación, no en popularidad del usuario.

## Privacidad

### Regla de oro

**Raw video stays on device by default.**

El servidor no necesita conocer quién pasó. Necesita conocer que una entidad de una determinada categoría cruzó una geometría a cierta hora.

### Minimización

Evitar almacenar:

- rostros;
- matrículas;
- audio;
- descriptores biométricos;
- identificadores persistentes de peatones/vehículos entre cámaras;
- video continuo en la nube.

Los identificadores de track deben ser locales a una sesión/nodo y no permitir seguimiento entre sensores.

## Datos espaciales y riesgo residencial

Un nodo instalado en una ventana puede revelar el domicilio de la persona que contribuye. Por ello deben existir al menos tres representaciones geográficas:

1. `private_location`: coordenada técnica precisa, acceso restringido;
2. `analysis_location`: geometría necesaria para análisis, protegida;
3. `public_location`: celda/segmento o punto deliberadamente generalizado.

Nunca se debe exponer públicamente una relación directa usuario ↔ domicilio ↔ sensor.

## Incentivos comunitarios

La recompensa principal debe ser conocimiento útil, no gamificación vacía.

Cada participante debería poder ver:

- horas aportadas;
- cobertura generada;
- modos observados;
- evolución de su calle;
- comparación agregada con el barrio/comuna;
- investigaciones o decisiones que utilizaron los datos;
- estado y calidad de su nodo.

Podemos incorporar reconocimientos por continuidad y validación, pero nunca premiar simplemente más conteos porque eso incentivaría datos artificiales.

## Productos colectivos

Una red suficientemente densa permitiría construir:

- perfiles horarios de peatones y ciclistas donde hoy no existen aforos sistemáticos;
- estacionalidad semanal y anual;
- efectos antes/después de ciclovías y proyectos urbanos;
- variaciones por lluvia, eventos y obras;
- movilidad barrial;
- exposición temporal del espacio público;
- detección de discontinuidades en infraestructura activa;
- matrices aproximadas de continuidad de corredores, con cautela metodológica;
- indicadores de vitalidad y uso del espacio público;
- repositorios abiertos para investigación.

No debe inferirse origen-destino individual conectando identidades entre cámaras. La red mide flujos agregados, no personas identificables.

## Estrategia de despliegue

### Fase A — nodo autónomo

Konta2r v2 funciona correctamente en un teléfono durante sesiones largas y genera datos locales auditables.

### Fase B — nodo conectado

Registro de dispositivo, autenticación, buffer offline y sincronización de eventos/agregados.

### Fase C — piloto comunitario

10–30 nodos en tipologías urbanas distintas. Validación manual intensiva y observación del comportamiento térmico/energético de teléfonos reutilizados.

### Fase D — commons

Mapa, API, descargas, panel de contribuyente y documentación de metodología.

### Fase E — red abierta

Alta autoservicio, score de calidad, mecanismos anti-abuso y programas de ciencia ciudadana.

## Métrica principal de éxito

El éxito no debe medirse por cantidad de teléfonos conectados. Debe medirse por **horas-nodo válidas de observación**, cobertura espacial y temporal, error conocido y reutilización efectiva de los datos.

## Decisión arquitectónica

Desde ahora Konta2r debe tratar `community` como una capa de primer nivel. El núcleo Edge debe funcionar completamente offline y producir un contrato de eventos independiente del backend. Así la herramienta continúa siendo útil para un investigador individual y, al mismo tiempo, puede integrarse en una red distribuida sin cambiar su lógica de medición.