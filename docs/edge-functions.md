# Edge Functions de Konta2r

## Fronteras de autenticación

Konta2r separa la identidad humana de la identidad del sensor:

| Función | `verify_jwt` | Identidad |
|---|---:|---|
| `node-enroll` | `true` | persona autenticada por Supabase Auth/Google |
| `node-lifecycle` | `true` | persona propietaria que activa, pausa, revoca o rota credencial |
| `ingest-community` | `false` | sensor con `Authorization: Konta2rNode ...` |

`ingest-community` no puede usar el `verify_jwt` del gateway porque ese control espera un `Bearer` JWT de Supabase. Desactivarlo aquí no vuelve público el endpoint: desplaza la autenticación al contrato criptográfico de nodo que ejecuta `evaluateCommunityIngest()`.

## Defensa adicional en endpoints humanos

Aunque el gateway valida el JWT, `node-enroll` y `node-lifecycle` vuelven a consultar `/auth/v1/user` antes de cualquier SQL privilegiado. El `owner_user_id` se toma de esa respuesta y nunca del JSON enviado por el cliente.

Esto es necesario porque las funciones conectan directamente a PostgreSQL y, por tanto, no dependen de RLS para esas escrituras.

## Por qué PostgreSQL directo

Las credenciales, auditoría de ciclo de vida y batches Community viven en `private.*`, que deliberadamente no está expuesto por Data API. No se debe exponer `private` solo para facilitar el acceso desde `supabase-js`.

Las funciones usan Postgres.js fijado exactamente en `3.4.9` y `SUPABASE_DB_URL`. `prepare:false` mantiene compatibilidad con transaction pooler. El driver se importa directamente con un specifier versionado; no se usa `latest`.

Las operaciones críticas son transaccionales:

- enrolamiento: `public.nodes` + `private.node_credentials`;
- ciclo de vida: estado + credencial cuando corresponde + `private.node_lifecycle_events`;
- ingestión: batch + todos sus agregados + `last_used_at`.

Las mutaciones de ciclo de vida bloquean la fila del nodo con `FOR UPDATE`. Si el estado cambió entre lectura y escritura, la operación falla como conflicto en vez de sobreescribir un estado más reciente.

## Secretos del runtime

Los siguientes valores son **solo de servidor**:

```text
SUPABASE_DB_URL
KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION
KONTA2R_NODE_TOKEN_PEPPER_V1
KONTA2R_NODE_TOKEN_PEPPER_V2
...
```

`KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION` selecciona la versión usada para credenciales nuevas y rotadas. Ingestión no usa esa variable para verificar un nodo existente: lee `private.node_credentials.key_version` y selecciona el pepper correspondiente. Esto permite introducir una versión nueva sin invalidar inmediatamente credenciales anteriores.

Para verificar Auth se requiere además el URL del proyecto y una publishable key. La función acepta `SUPABASE_PUBLISHABLE_KEY` o la configuración administrada `SUPABASE_PUBLISHABLE_KEYS` cuando esté disponible en el proyecto.

Nunca deben copiarse a `VITE_*`:

```text
SUPABASE_DB_URL
KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION
KONTA2R_NODE_TOKEN_PEPPER_V*
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

El nodo queda `provisioning`. No puede ingerir datos hasta que su propietario lo active explícitamente.

## Ciclo de vida

```text
provisioning ── activate ──> active
                              │
                            pause
                              ↓
                            paused
                              │
                           activate
                              ↓
                            active

provisioning / active / paused ── revoke ──> revoked (terminal)

provisioning / active / paused ── rotate ──> mismo estado + nueva credencial
```

Reglas:

- `activate` sobre `active`, `pause` sobre `paused` y `revoke` sobre `revoked` son no-op idempotentes;
- `pause` desde `provisioning` no es válido;
- un nodo `revoked` no puede volver a activarse ni rotar credencial;
- para reutilizar físicamente un sensor revocado se debe enrolar un nodo nuevo;
- `rotate` conserva `nodeId`, reemplaza HMAC/key version, limpia estado de uso de la credencial anterior y retorna el token nuevo una sola vez;
- cada cambio efectivo se registra en `private.node_lifecycle_events` con actor humano, acción, estado anterior/siguiente y versión de credencial.

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

Las operaciones de ciclo de vida pasan por `node-lifecycle`, autenticado y auditable.

## Verificación antes de desplegar

El código está preparado en repositorio, pero no debe desplegarse hasta disponer del proyecto Supabase de Konta2r. En ese momento:

1. inicializar/validar `supabase/config.toml` con la CLI vigente;
2. generar la migración real a partir de `supabase/schema.sql`;
3. configurar secretos del proyecto, incluida versión activa y peppers necesarios;
4. ejecutar `supabase functions serve` y `deno check`/tests locales;
5. aplicar esquema en desarrollo;
6. ejecutar Security y Performance Advisors;
7. probar con dos usuarios humanos y al menos dos nodos;
8. probar propiedad cruzada, activación, pausa, rotación, revocación terminal y carreras concurrentes;
9. probar token incorrecto, token revocado, replay idéntico y conflicto de secuencia;
10. solo entonces desplegar las funciones.

No se debe usar el proyecto Supabase de otro sistema como entorno transitorio de Konta2r.
