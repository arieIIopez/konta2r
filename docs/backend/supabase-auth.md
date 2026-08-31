# Backend Supabase y Google Auth

## Decisión

Konta2r usará Supabase como backend administrado sobre PostgreSQL. La arquitectura mantiene dos identidades separadas:

- **persona**: Supabase Auth con Google;
- **nodo**: credencial Konta2r propia, revocable y de alta entropía.

La sesión Google de una persona sirve para registrar, configurar y revocar sus nodos. Un teléfono que observa durante días o meses no conserva una sesión Google como identidad del sensor.

## Estado de este bloque

`supabase/schema.sql` es un **prototipo de esquema**, no una migración aplicada. Al crear el proyecto Supabase de Konta2r se debe generar la migración con la CLI vigente (`supabase migration new ...`) y revisar/copiar este SQL dentro del archivo generado. No se debe reutilizar un proyecto Supabase ajeno a Konta2r.

## Google: identidad mínima

El login solicita únicamente:

- `openid`
- `email`
- `profile`

Konta2r no necesita acceso a Gmail, Drive, Calendar, Contacts ni APIs de Google. Tampoco solicita `access_type=offline` ni persiste `provider_token`/`provider_refresh_token` de Google.

En web, la aplicación termina usando Supabase Auth:

```ts
supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: 'https://konta2r.example/',
    scopes: 'openid email profile',
  },
})
```

El código de dominio vive en `src/auth/googleAuth.ts` y recibe un cliente Supabase por inyección. La dependencia concreta `@supabase/supabase-js` se añadirá cuando exista el proyecto de Konta2r y pueda generarse/commitirse el lockfile correspondiente; este hito no introduce una dependencia sin lockfile.

## Configuración Google Cloud

Para la aplicación web:

1. Crear/usar un proyecto Google Cloud para Konta2r.
2. Configurar Branding/Audience en Google Auth Platform.
3. Añadir los scopes mínimos `openid`, email y profile.
4. Crear un OAuth Client ID de tipo **Web application**.
5. Añadir como JavaScript origin el dominio de Konta2r y el origin local de desarrollo.
6. Añadir como Authorized redirect URI el callback que muestre el proyecto Supabase en Authentication → Providers → Google.
7. Guardar Client ID y Client Secret en la configuración del proveedor Google de Supabase, nunca en el repositorio.

Para producción es recomendable un dominio de autenticación reconocible (`auth.<dominio>` o similar) y branding verificado para reducir riesgo de phishing.

## Configuración frontend

Solo se exponen dos valores:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

`src/backend/supabaseConfig.ts` rechaza claves `sb_secret_*`, service-role y URLs HTTP remotas.

Nunca deben existir en variables `VITE_*`:

- service role;
- secret key;
- password de PostgreSQL;
- Google Client Secret;
- pepper/HMAC key de credenciales de nodo.

## Modelo de datos inicial

### `public.profiles`

Perfil de aplicación asociado a `auth.users.id`. La autorización se basa en `auth.uid()`, no en `raw_user_meta_data` ni campos editables del perfil Google.

### `public.segments`

Tramos observables de calle, ciclovía, vereda o espacio compartido. Usa PostGIS `LineString 4326` y permite que el nodo se asocie a un segmento público sin publicar una coordenada exacta de domicilio.

### `public.nodes`

Registro pseudónimo de sensores. `owner_user_id` vincula el nodo con la cuenta autenticada, protegido por RLS. Esa relación es privada y no forma parte del payload Community.

### `private.node_credentials`

Solo conserva un HMAC-SHA256 de la credencial del nodo. La credencial original debe ser generada y mostrada una vez durante enrolamiento; nunca se persiste en claro.

El HMAC debe calcularse en una Edge Function con un secreto de servidor como `KONTA2R_NODE_TOKEN_PEPPER`. Ese secreto no vive en PostgreSQL ni en el navegador.

### `private.community_batches`

Envelope técnico del protocolo Community. Mantiene `node_id:sequence` como clave idempotente y guarda calidad/runtime/versiones sin video ni identidad humana.

### `private.flow_aggregates` y `private.spatial_aggregates`

Registros agregados equivalentes al protocolo que ya produce el nodo. No son tablas públicas. La futura capa Commons se derivará de estas tablas aplicando reglas de publicación y supresión adicionales.

## RLS y Data API

Konta2r trata **grants** y **RLS** como controles distintos:

- grants: determinan si `anon`/`authenticated` pueden alcanzar el objeto;
- RLS: determina qué filas puede usar una identidad que ya tiene acceso al objeto.

En el esquema inicial:

- `profiles`: el usuario solo ve/inserta/actualiza su fila;
- `nodes`: el usuario solo ve/inserta/actualiza sus nodos;
- `segments`: lectura pública, escritura solo desde backend confiable;
- `private.*`: sin acceso de `anon` ni `authenticated`.

No se usan vistas públicas en esta etapa. Cuando se creen vistas Commons deberán usar `security_invoker=true` o una superficie no expuesta apropiada, según su función.

## Enrolamiento de nodo previsto

```text
Persona inicia sesión con Google
        ↓
Supabase Auth / JWT humano
        ↓
"Agregar nodo"
        ↓
Edge Function node-enroll (JWT obligatorio)
        ↓
crea node_<id>
crea token aleatorio de 256 bits
calcula HMAC(token, pepper)
guarda solo HMAC
        ↓
retorna token UNA vez
        ↓
IndexedDB / almacenamiento local del nodo
```

Revocar el nodo marca su credencial como revocada sin cerrar ni modificar la cuenta Google del propietario.

## Ingestión prevista

El endpoint de ingestión será una Edge Function con autenticación de nodo propia. Como los nodos no usan una sesión humana, esa función deberá validar el token Konta2r explícitamente antes de escribir en `private.*`. Solo en ese endpoint tendría sentido desactivar la verificación JWT estándar de Supabase, y únicamente porque la función implementará su propio control criptográfico de credencial.

El orden será:

```text
CommunityUploadEnvelope local
        ↓
validateCommunityUpload()
        ↓
outbox IndexedDB
        ↓
HTTPS + credencial de nodo
        ↓
Edge Function ingest
        ↓
HMAC y revocación
        ↓
(node_id, sequence) idempotente
        ↓
private.community_batches
        ↓
flow/spatial aggregates
```

## Lo que deliberadamente no se almacena

- video o audio;
- frames/snapshots de observación;
- rostros o patentes;
- embeddings biométricos;
- `trackId` o trayectorias individuales públicas;
- coordenada exacta del domicilio del nodo;
- tokens OAuth de Google para acceder a servicios Google;
- credenciales de nodo en texto claro.

## Próximo paso de despliegue

Cuando se decida crear el proyecto Supabase de Konta2r:

1. elegir explícitamente la organización y región;
2. revisar costo antes de crear el proyecto;
3. generar la primera migración con la CLI vigente;
4. aplicar el esquema en un entorno de desarrollo;
5. ejecutar Security/Performance Advisors;
6. configurar Google provider y redirect allow list;
7. añadir `@supabase/supabase-js` con versión exacta y lockfile;
8. conectar el botón Google y el panel "Mis nodos";
9. implementar `node-enroll` e `ingest-community`;
10. probar RLS con al menos dos usuarios y un nodo revocado antes de producción.
