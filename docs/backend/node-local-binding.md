# Binding local del nodo

## Propósito

Después de un reinicio, un teléfono usado como Konta2r Node debe poder reconstruir su contexto técnico sin pedir nuevamente el token del sensor ni mezclar secretos con la cola Community.

El **binding local** responde solamente:

```text
¿qué nodo representa este dispositivo?
```

Persiste:

- `nodeId` pseudónimo;
- etiqueta local;
- `segmentId` observado;
- último estado conocido;
- versión numérica de credencial, sin el token;
- timestamp de actualización.

No persiste:

- credential raw;
- HMAC del backend;
- JWT humano;
- Google tokens;
- video, frames o tracks.

## Tres dominios IndexedDB separados

```text
Konta2rNodeConfigDB
  → binding local no secreto

Konta2rNodeSecretsDB
  → CryptoKey + credential cifrada

Konta2rCommunityDB
  → envelopes agregados + reintentos
```

Separar estas bases facilita inspección y exportación del outbox sin tocar autenticación y evita convertir metadata ordinaria en un contenedor de secretos.

## Estado cacheado no es autorización

`LocalNodeBinding.status` es solo una copia conveniente del último resultado recibido desde `node-lifecycle`.

No se usa como prueba de que el servidor autorizará una ingestión. Otro dispositivo o sesión humana podría haber pausado/revocado el nodo desde que se escribió el cache.

La autoridad sigue estando en:

```text
public.nodes.status
+
private.node_credentials
```

que `ingest-community` consulta en backend.

## Enrolamiento

El orden es deliberado:

```text
node-enroll
  ↓
NodeControlClient guarda credential en vault
  ↓
retorna solo metadata + credentialStored=true
  ↓
NodeProvisioningCoordinator escribe binding no secreto
```

Así no se persiste un binding operativo si la custodia de la credencial falló.

## Ciclo de vida

Para `activate`, `pause`, `revoke` y `rotate`:

1. el coordinator lee el binding actual;
2. llama al endpoint humano para ese mismo `nodeId`;
3. el backend autoriza y ejecuta la transición;
4. `NodeControlClient` actualiza/elimina el vault cuando corresponde;
5. solo después se actualiza el cache local.

Una respuesta con otro `nodeId` se rechaza como inconsistencia de identidad.

### Revocación

Un binding revocado se conserva localmente hasta que la persona decida limpiarlo. Esto permite que la interfaz explique por qué el dispositivo ya no puede operar, en lugar de parecer “sin configurar”.

La presencia del binding no reactiva nada: `revoked` sigue siendo terminal en backend y la credencial local ya fue eliminada por `NodeControlClient`.

`clearLocalBinding()` elimina únicamente metadata local; no modifica el servidor ni el vault. Las acciones destructivas remotas deben pasar siempre por el endpoint humano correspondiente.

## Recuperación tras reinicio

El flujo previsto es:

```text
PWA inicia
  ↓
IndexedDbNodeLocalBindingStore.get()
  ↓
valida schema + nodeId + segmento
  ↓
IndexedDbNodeCredentialVault.has(nodeId)
  ↓
si existe contexto utilizable:
    crear CommunityDeliveryRuntime
si falta credential:
    mostrar recuperación por rotación humana
```

La restauración automática del runtime y su UI se implementan en el siguiente bloque; este documento no afirma todavía que esa experiencia esté conectada al `NodePanel`.

## Privacidad

El `segmentId` representa un tramo de análisis, no coordenadas precisas del domicilio. El contrato mantiene la regla Community de no publicar ubicación exacta del sensor.

El binding es local y no forma parte de uploads Community.
