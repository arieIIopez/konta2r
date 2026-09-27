# Ingestión Community autenticada

## Propósito

La ingestión remota recibe únicamente `CommunityUploadEnvelope` agregados. La identidad del sensor es independiente de Google/Supabase Auth: una sesión humana administra nodos, pero nunca autentica observación continua.

## Autenticación HTTP

El nodo envía su credencial propia mediante el encabezado estándar `Authorization` con un esquema Konta2r explícito:

```http
Authorization: Konta2rNode k2n_v1_<43 caracteres base64url>
```

No se acepta:

- `Bearer <JWT Supabase>`;
- Google access/refresh tokens;
- `sb_publishable_*`;
- `sb_secret_*`;
- service-role keys.

El uso de un esquema distinto de `Bearer` hace visible en el contrato que la llamada representa a un **sensor**, no a una persona.

## Idempotencia

Cada upload lleva:

```http
Idempotency-Key: <nodeId>:<sequence>
```

El backend exige simultáneamente:

1. `Idempotency-Key === nodeId + ':' + sequence`;
2. unicidad PostgreSQL de `(node_id, sequence)`;
3. `payload_sha256` calculado sobre JSON canónico del envelope.

Semántica:

- primera recepción válida: `202 community_upload_accepted`;
- replay exacto de un batch ya persistido: `200 community_upload_already_accepted`;
- misma secuencia con contenido diferente: `409 sequence_payload_conflict`.

Esto permite reintentos seguros del outbox sin aceptar una mutación silenciosa de datos históricos.

## Autorización del segmento

Un token válido no autoriza al nodo a declarar cualquier ubicación. Antes de persistir, el backend compara:

```text
envelope.observedSegment.segmentId
              ==
public.nodes.segment_id
```

Si no coincide, la ingestión responde `403 segment_not_authorized`.

La medida evita que una credencial comprometida pueda atribuir observaciones a otro tramo sin una reconfiguración explícita del nodo por su propietario.

## Estado de nodo y credencial

Solo un nodo `active` puede ingerir. Se rechazan:

- nodo inexistente;
- nodo revocado;
- credencial revocada;
- credencial vencida;
- HMAC incorrecto;
- nodo `provisioning` o `paused`;
- `keyVersion` cuyo pepper no esté disponible.

El backend compara HMAC-SHA256, nunca el token raw persistido, porque el token raw no existe en la base de datos.

## Frontera transaccional

La implementación concreta de `CommunityIngestStore.persistCommunityUpload()` debe ejecutar en **una sola transacción**:

1. insertar/identificar `private.community_batches`;
2. resolver el conflicto `(node_id, sequence)`;
3. comparar `payload_sha256` si ya existía;
4. insertar todos los `flow_aggregates` y `spatial_aggregates` del batch nuevo;
5. actualizar `private.node_credentials.last_used_at`.

No se debe confirmar el batch y luego insertar agregados en operaciones independientes.

## Códigos previstos

| HTTP | Código | Significado |
|---|---|---|
| 200 | `community_upload_already_accepted` | replay idéntico |
| 202 | `community_upload_accepted` | batch nuevo persistido |
| 400 | `idempotency_key_mismatch` | header y envelope no corresponden |
| 401 | `invalid_node_auth` | autenticación de sensor inválida |
| 403 | `node_not_active` | nodo pausado/provisioning |
| 403 | `segment_not_authorized` | tramo distinto al configurado |
| 409 | `sequence_payload_conflict` | misma secuencia, payload diferente |
| 422 | `invalid_community_payload` | viola el protocolo Community |
| 503 | `credential_key_unavailable` | configuración de claves del servidor incompleta |

## Siguiente implementación

Cuando exista el proyecto Supabase de Konta2r, una Edge Function `ingest-community` adaptará `Request`/PostgreSQL a `evaluateCommunityIngest()`. La política central ya queda independiente del runtime y cubierta por tests; la Edge Function debe ser una capa delgada, no duplicar estas reglas.
