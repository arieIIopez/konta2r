# Boundary HTTP para `ingest-community`

## Objetivo

`communityHttpHandler.ts` deja preparada la capa HTTP de la futura Supabase Edge Function sin acoplarla todavía a Deno, a un driver PostgreSQL ni a secretos de proyecto.

El handler recibe tres piezas por composición:

- `NodeCredentialVerifier`;
- `CommunityIngestionStore`;
- configuración HTTP/CORS.

Por eso la futura función podrá limitarse a crear el driver/secret providers y llamar a este boundary.

## CORS no es autenticación

La aplicación web necesita responder preflight `OPTIONS`. Sin embargo, Konta2r no usa CORS como control de identidad.

El control real sigue siendo:

```text
Authorization: Konta2rNode k2n_v1_...
```

El handler exige una allowlist explícita de orígenes web. No existe un `*` por defecto.

Una request sin `Origin` se permite para clientes no-browser, pruebas de integración o herramientas administrativas, pero debe superar exactamente la misma autenticación de nodo.

No se usa `Access-Control-Allow-Credentials`; la ingestión no depende de cookies de sesión humana.

## Headers permitidos en preflight

La respuesta CORS permite únicamente los headers previstos por el protocolo y la infraestructura:

```text
authorization
apikey
content-type
idempotency-key
x-client-info
x-konta2r-schema
x-konta2r-methodology
```

`apikey` queda disponible para el gateway Supabase cuando corresponda. La credencial del sensor no se reemplaza por la API key Supabase.

## Métodos

Solo existen dos métodos válidos:

- `OPTIONS`: preflight;
- `POST`: ingestión.

Cualquier otro método retorna `405` antes de leer el body.

## Límite del body

El límite por defecto es 4 MiB.

Si existe `Content-Length` y excede el máximo, se rechaza antes de consumir el stream. Como ese header no constituye evidencia suficiente por sí solo, la capa `processCommunityIngestion()` vuelve a calcular el tamaño UTF-8 real después de leer el body.

## Respuestas

Las respuestas de éxito exponen únicamente:

```json
{
  "status": "inserted | duplicate",
  "batchId": "...",
  "payloadSha256": "..."
}
```

Los errores esperados exponen solo un código estable, por ejemplo:

```json
{ "error": "invalid_authorization" }
```

No se refleja el payload, el token, mensajes SQL ni detalles de infraestructura.

Todos los responses incluyen:

```text
Cache-Control: no-store
X-Content-Type-Options: nosniff
Vary: Origin
```

## Fallos internos

Una caída del lookup PostgreSQL, secret provider o store no se transforma en `401`. Eso ocultaría un problema operacional como si fuera una credencial incorrecta.

El handler captura esos fallos y devuelve:

```text
HTTP 500
{"error":"internal_error"}
```

El detalle original solo llega al logger inyectado. Ese logger tampoco recibe el body ni la credencial desde este boundary.

## Configuración de orígenes

Los orígenes de producción deben usar HTTPS. Se permite HTTP únicamente para:

- `localhost`;
- `127.0.0.1`.

Las entradas deben ser orígenes, no rutas completas.

Ejemplo conceptual:

```ts
createCommunityHttpHandler(verifier, store, {
  allowedOrigins: [
    'https://konta2r.example',
    'http://localhost:5173',
  ],
})
```

El dominio real se definirá al desplegar Konta2r; no se debe convertir el placeholder documental en configuración de producción.

## Supabase Edge Function futura

La composición final tendrá aproximadamente esta forma:

```text
Deno.serve(request)
     ↓
Postgres driver desde SUPABASE_DB_URL
     ↓
createPostgresNodeCredentialLookup()
     ↓
createCryptographicNodeCredentialVerifier()
     ↓
createPostgresCommunityIngestionStore()
     ↓
createCommunityHttpHandler()
     ↓
Response
```

La función de sensor utilizará autenticación propia, por lo que deberá configurarse con `verify_jwt = false` y validar `Konta2rNode` dentro del código.

Esto no se desplegará hasta disponer del proyecto Supabase de Konta2r, driver fijado, lockfile/import resolution reproducible y secretos configurados correctamente.
