# Autoprovisionamiento de un nodo Community

## Propósito

Un teléfono antiguo debe poder convertirse en un nodo Konta2r sin conservar una sesión humana de Google/Supabase durante la observación continua.

La identidad humana y la identidad del sensor son deliberadamente distintas:

```text
persona
  ↓ Google / Supabase Auth
sesión humana temporal
  ↓ node-enroll
nodeId + credencial de sensor
  ↓ persistencia local en el teléfono
node-lifecycle: activate
  ↓
nodo autónomo
  ↓ Konta2rNode credential
ingest-community
```

La sesión humana autoriza el enrolamiento y las mutaciones administrativas. La credencial `k2n_v1_*` autentica al sensor durante la operación.

## Frontera HTTP del cliente humano

`src/community/nodeAdminClient.ts` llama únicamente a:

- `node-enroll`;
- `node-lifecycle`.

Para llamadas de una persona autenticada envía dos encabezados distintos:

```http
apikey: sb_publishable_...
Authorization: Bearer <Supabase Auth access token>
```

La publishable key identifica el proyecto/aplicación y es apta para cliente. El `Authorization` contiene el JWT de la persona. Una `sb_secret_*` se rechaza explícitamente en el navegador.

No se reutiliza ninguno de esos valores como credencial del sensor.

## Estado local recuperable

`src/community/nodeProvisioning.ts` mantiene la identidad local:

- `nodeId` pseudónimo;
- etiqueta y segmento observado;
- estado operacional;
- versión de credencial;
- credencial cruda del sensor solo mientras el nodo no haya sido revocado;
- timestamps de enrolamiento y última actualización.

La persistencia concreta vive en `IndexedDbNodeIdentityStore`, separada de la cola de uploads.

La separación permite borrar o migrar la cola sin destruir la identidad criptográfica del nodo.

## Por qué enrolar y activar son dos operaciones

No existe una transacción distribuida entre el navegador y PostgreSQL. El orden seguro es:

1. `node-enroll` crea el nodo y retorna la credencial una sola vez;
2. el teléfono persiste inmediatamente esa credencial;
3. recién entonces solicita `activate`.

Si la red falla en el paso 3, el teléfono conserva un nodo válido en `provisioning` y puede reintentar la activación. Si se intentara activar antes de persistir, un cierre del navegador podría dejar un nodo activo cuya credencial ya no puede recuperarse.

## Rotación

La rotación conserva `nodeId` y estado operacional:

1. la persona autenticada solicita `rotate`;
2. el servidor reemplaza HMAC y versión en una transacción;
3. retorna la nueva credencial una sola vez;
4. el teléfono sustituye la credencial local solo después de una respuesta válida.

La credencial anterior queda inválida desde la confirmación del servidor.

## Revocación

La revocación es terminal. Después de que el servidor confirma `revoked`:

- el teléfono elimina la credencial cruda de su identidad local;
- conserva metadata mínima para impedir una reutilización accidental;
- `activeCredential()` deja de entregar material para `ingest-community`;
- solo una identidad local ya revocada puede eliminarse para enrolar nuevamente el dispositivo como un nodo nuevo.

## Límite de seguridad del navegador

IndexedDB da persistencia, no aislamiento frente a JavaScript del mismo origen. Una vulnerabilidad XSS podría leer la credencial de nodo mientras está vigente. Por tanto, antes de producción Konta2r debe mantener una política CSP estricta, dependencias fijadas y ausencia de scripts de terceros no controlados en la superficie PWA del nodo.

El backend reduce el impacto de una credencial comprometida mediante:

- segmentación autorizada por nodo;
- estados `paused/revoked`;
- rotación;
- HMAC server-side con pepper versionado;
- ausencia de video, frames, tracks y coordenadas residenciales exactas en el backend.

## Paso siguiente

Una vez validada esta capa con CI, la interfaz `NodePanel` puede incorporar un modo de configuración que:

1. detecte si existe identidad local;
2. solicite login humano solo para enrolar o administrar;
3. muestre `provisioning / active / paused / revoked` sin mostrar la credencial cruda;
4. al iniciar operación Community entregue `activeCredential()` al transporte de uploads;
5. permita cerrar la sesión humana después de completar la configuración.
