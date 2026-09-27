# Community delivery v2

## Objetivo

Este runtime une el autoprovisionamiento actual del teléfono con la cola offline de Community. La identidad humana de Google/Supabase no participa en la entrega de datos: cada intento usa únicamente la credencial `Konta2rNode` del nodo activo.

```text
cruces/tracks locales
       ↓
agregación pública (sin trackId, eventId, geometryId ni timestamp exacto)
       ↓
CommunityBatchDraft
       ↓
identidad local activa → nodeId + segmentId
       ↓
secuencia persistente por nodeId
       ↓
Konta2rCommunityDB (outbox)
       ↓
flush limitado al mismo nodeId
       ↓
Authorization: Konta2rNode <credencial vigente>
       ↓
ingest-community
```

## Secuencia persistente

`IndexedDbCommunitySequenceStore` usa una base separada (`Konta2rCommunitySequenceDB`) y asigna una secuencia monotónica por `nodeId`.

La asignación se confirma antes de encolar. Un cierre abrupto puede dejar un salto en la numeración, lo que es aceptable porque el backend exige unicidad `(nodeId, sequence)`, no continuidad. Esta estrategia evita reutilizar una secuencia que pudo haber alcanzado el backend antes de un reinicio del teléfono.

## Nodo activo como frontera

`CommunityDeliveryRuntime.enqueue()` sólo crea un lote si existe una identidad de sensor activa. El `segmentId` público se obtiene de esa identidad; nunca se deriva una coordenada doméstica.

`flush()` vuelve a consultar la identidad activa y limita la lectura del outbox a ese mismo `nodeId`. Existe además un filtro defensivo en `flushCommunityOutbox()` aunque un store personalizado ignore el argumento opcional de nodo.

Por esto, después de revocar/olvidar un nodo y crear otro, un batch pendiente del nodo anterior no puede salir autenticado con la credencial del nodo nuevo.

## Pausa, revocación y rotación

Si no existe un nodo activo, `flush()` retorna `skipped: node_inactive` sin incrementar intentos ni convertir registros en dead-letter.

Si una credencial cambia entre la lectura local y la verificación remota, una respuesta 401/403 se conserva como fallo reintentable. El objetivo es que una carrera de rotación no destruya un agregado válido.

## Compatibilidad exacta con el backend

Los agregados de flujo públicos ya no incluyen `geometryId`. Ese identificador sigue siendo útil para agrupar cruces localmente, pero no forma parte de `PublicFlowAggregate` ni del parser estricto de `ingest-community`.

La salida pública mantiene únicamente bucket temporal, tipo de entidad, sentido, conteo y calidad media.

## Persistencia local

- `Konta2rNodeIdentityDB`: identidad y credencial del sensor.
- `Konta2rCommunityDB`: batches agregados y estado de reintento.
- `Konta2rCommunitySequenceDB`: siguiente secuencia por nodo.

Ninguna de estas capas contiene video, imágenes, bounding boxes, trayectorias individuales o identificadores de tracks en el payload Community.

## Siguiente integración

El siguiente paso es conectar los eventos de cruce del loop real de inferencia a una ventana de agregación de cinco minutos y entregar esos `PublicFlowAggregate[]` al `CommunityDeliveryRuntime`, incluyendo el snapshot real de calidad y salud del nodo. El envío debe dispararse sólo al cerrar buckets completos y también al recuperar conectividad.
