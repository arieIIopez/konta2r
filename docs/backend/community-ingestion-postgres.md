# Persistencia PostgreSQL de Community

## Decisión arquitectónica

La ingestión Community persiste directamente en PostgreSQL desde la futura Edge Function, usando una conexión server-side basada en `SUPABASE_DB_URL`.

Esto es deliberado. Las tablas de ingestión permanecen en el esquema `private`, fuera de la superficie Data API. Konta2r no expondrá `private.community_batches`, `private.flow_aggregates`, `private.spatial_aggregates` ni `private.node_credentials` solo para poder usar `supabase-js` desde la función.

La documentación vigente de Supabase admite conexiones directas a PostgreSQL desde Edge Functions mediante drivers compatibles con Deno/serverless. La dependencia concreta se elegirá y fijará con versión exacta cuando exista el proyecto Supabase de Konta2r; este módulo mantiene por ahora un contrato driver-neutral.

## Flujo

```text
HTTP Community upload
       ↓
processCommunityIngestion()
       ↓
parser exacto + privacy gate
       ↓
Konta2rNode credential
       ↓
segment binding
       ↓
payload SHA-256
       ↓
createPostgresCommunityIngestionStore()
       ↓
transacción PostgreSQL
       ↓
private.community_batches
       ├─ private.flow_aggregates
       └─ private.spatial_aggregates
```

## Idempotencia bajo concurrencia

El identificador lógico de un envío es:

```text
(node_id, sequence)
```

La tabla `private.community_batches` ya contiene una restricción `UNIQUE (node_id, sequence)`.

La persistencia usa:

```sql
insert ...
on conflict (node_id, sequence) do nothing
returning batch_id, payload_sha256
```

No se realiza un `SELECT` de existencia antes del `INSERT`. Ese patrón tendría una ventana de carrera si dos reintentos llegaran simultáneamente.

PostgreSQL decide atómicamente cuál request inserta. Si el `INSERT` no retorna fila, la misma transacción recupera el registro ganador:

- mismo `payload_sha256` → reintento idéntico, respuesta lógica `duplicate_same_payload`;
- distinto `payload_sha256` → reutilización inválida de la secuencia, `conflict`;
- ninguna fila visible → violación de invariantes y rollback.

Por tanto una secuencia no puede representar silenciosamente dos contenidos diferentes.

## Atomicidad del batch

Cuando el batch es nuevo, una única transacción contiene:

1. inserción de `community_batches`;
2. inserción masiva de agregados de flujo;
3. inserción masiva de agregados espaciales;
4. actualización de `node_credentials.last_used_at`.

Si falla cualquier agregado, la transacción completa debe revertirse. No puede quedar un envelope sin sus records ni un subconjunto parcial de records.

Los registros se insertan por familia mediante `jsonb_to_recordset`, evitando una query individual por cada celda o flujo.

## Frontera de confianza

`postgresCommunityStore.ts` asume que `processCommunityIngestion()` ya produjo un `PreparedCommunityBatch` validado. Aun así, PostgreSQL conserva constraints propios como segunda barrera:

- calidad dentro de `[0,1]`;
- buckets ordenados y de al menos un minuto;
- conteos no negativos;
- celdas públicas de al menos 2 m;
- unicidad `(node_id, sequence)`;
- claves foráneas hacia nodo y segmento.

La aplicación no construye SQL con valores del payload. Todos los valores no confiables se envían como parámetros. Los tests incluyen cadenas con sintaxis SQL para comprobar que no son interpoladas dentro del statement.

## Lookup de credencial

La futura función consulta server-side:

```text
public.nodes
    JOIN
private.node_credentials
```

De allí obtiene únicamente lo necesario para autenticar el sensor:

- `node_id`;
- `segment_id`;
- estado del nodo;
- HMAC de credencial;
- versión de clave;
- expiración/revocación.

La credencial original nunca existe en PostgreSQL.

## Edge Function futura

La función `ingest-community` usará autenticación propia `Konta2rNode`. Por eso su configuración deberá desactivar el `verify_jwt` de plataforma y ejecutar la autorización dentro del handler. Esto no convierte al endpoint en anónimo: sustituye el JWT humano por la credencial criptográfica específica del sensor.

Las nuevas API keys de Supabase (`sb_publishable_*` y `sb_secret_*`) no son JWT y no deben enviarse como `Authorization: Bearer ...`.

Para el acceso directo a PostgreSQL, la conexión y el pepper HMAC serán secretos exclusivos del entorno de la Edge Function.

## Secretos que nunca llegan al navegador

Nunca se incorporarán a `VITE_*`, service worker, IndexedDB Community ni bundle público:

- `SUPABASE_DB_URL`;
- password de PostgreSQL;
- `sb_secret_*`;
- legacy `service_role`;
- `KONTA2R_NODE_TOKEN_PEPPER`;
- Google Client Secret.

El teléfono conserva solo su propia credencial `k2n_v1_...`.

## Dependencia PostgreSQL

Este hito no añade todavía un driver. Cuando exista el proyecto Supabase:

1. revisar la documentación vigente;
2. elegir un driver compatible con Supabase Edge Runtime y transaction pooler;
3. fijar versión exacta;
4. conservar/importar su lockfile o mecanismo equivalente de resolución reproducible;
5. probar la transacción contra una base de desarrollo;
6. ejecutar Security y Performance Advisors antes de producción.

## Estado

El adapter actual es ejecutable contra cualquier implementación de `TransactionalSqlExecutor`, pero todavía no ha sido probado contra una instancia real de PostgreSQL/Supabase. Los tests unitarios verifican el orden transaccional y los contratos; la validación de integración queda bloqueada hasta crear el proyecto Supabase específico de Konta2r.
