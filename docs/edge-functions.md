# Edge Functions de Konta2r

## Fronteras de autenticación

Konta2r usa dos funciones con identidades distintas:

| Función | `verify_jwt` | Identidad |
|---|---:|---|
| `node-enroll` | `true` | persona autenticada por Supabase Auth/Google |
| `ingest-community` | `false` | sensor con `Authorization: Konta2rNode ...` |

`ingest-community` no puede usar el `verify_jwt` del gateway porque ese control espera un `Bearer` JWT de Supabase. Desactivarlo aquí no vuelve público el endpoint: desplaza la autenticación al contrato criptográfico de nodo que ejecuta `evaluateCommunityIngest()`.

## Defensa adicional en `node-enroll`

Aunque el gateway valida el JWT, `node-enroll` vuelve a consultar `/auth/v1/user` antes de cualquier SQL privilegiado. El `owner_user_id` se toma de esa respuesta y nunca del JSON enviado por el cliente.

Esto es necesario porque la función conecta directamente a PostgreSQL y, por tanto, no depende de RLS para esa escritura.

## Por qué PostgreSQL directo

Las credenciales y los batches Community viven en `private.*`, que deliberadamente no está expuesto por Data API. No se debe exponer `private` solo para facilitar el acceso desde `supabase-js`.

Las funciones usan Postgres.js fijado exactamente en `3.4.9` y `SUPABASE_DB_URL`. `prepare:false` mantiene compatibilidad con transaction pooler. El driver se importa directamente con un specifier versionado; no se usa `latest`.

Las operaciones críticas son transaccionales:

- enrolamiento: `public.nodes` + `private.node_credentials`;
- ingestión: batch + todos sus agregados + `last_used_at`.

## Secretos del runtime

Los siguientes valores son **solo de servidor**:

```text
SUPABASE_DB_URL
KONTA2R_NODE_TOKEN_PEPPER_V1
```

Para verificar Auth se requiere además el URL del proyecto y una publishable key. La función acepta `SUPABASE_PUBLISHABLE_KEY` o la configuración administrada `SUPABASE_PUBLISHABLE_KEYS` cuando esté disponible en el proyecto.

Nunca deben copiarse a `VITE_*`:

```text
SUPABASE_DB_URL
KONTA2R_NODE_TOKEN_PEPPER_V1
Google Client Secret
sb_secret_*
service_role
password PostgreSQL
```

## Ciclo de enrolamiento

```text
persona inicia sesión con Google
        ↓
node-enroll (JWT humano)
        ↓
Supabase Auth confirma user.id
        ↓
valida segmento
        ↓
genera nodeId + token 256-bit
        ↓
transacción PostgreSQL
  public.nodes(status=provisioning)
  private.node_credentials(HMAC)
        ↓
retorna raw token una sola vez
```

El nodo queda `provisioning`. La activación será un cambio de estado explícito después de completar la configuración local; no se habilita ingestión automáticamente por el solo hecho de emitir una credencial.

## Ciclo de ingestión

```text
outbox local
  ↓
Authorization: Konta2rNode ...
Idempotency-Key: nodeId:sequence
  ↓
ingest-community (verify_jwt=false)
  ↓
validateCommunityUpload
  ↓
HMAC + estado + segmento + vencimiento
  ↓
payload SHA-256 canónico
  ↓
transacción PostgreSQL
  ↓
202 nuevo / 200 replay / 409 conflicto
```

## Data API

`public.nodes` queda expuesto al usuario solo para `SELECT` de sus propios nodos mediante RLS. No hay `INSERT` ni `UPDATE` para `authenticated`.

Esta decisión evita que un cliente web pueda:

- crear un `node_id` sin credencial válida;
- cambiar arbitrariamente el segmento observado;
- reactivar una credencial comprometida;
- saltarse el proceso de rotación/revocación.

Las operaciones de ciclo de vida se implementarán como endpoints autorizados y auditables.

## Verificación antes de desplegar

El código está preparado en repositorio, pero no debe desplegarse hasta disponer del proyecto Supabase de Konta2r. En ese momento:

1. inicializar/validar `supabase/config.toml` con la CLI vigente;
2. generar la migración real a partir de `supabase/schema.sql`;
3. configurar secretos del proyecto;
4. ejecutar `supabase functions serve` y `deno check`/tests locales;
5. aplicar esquema en desarrollo;
6. ejecutar Security y Performance Advisors;
7. probar con dos usuarios humanos y al menos dos nodos;
8. probar token incorrecto, token revocado, replay idéntico y conflicto de secuencia;
9. solo entonces desplegar las funciones.

No se debe usar el proyecto Supabase de otro sistema como entorno transitorio de Konta2r.
