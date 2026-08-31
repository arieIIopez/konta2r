# Runtime de entrega Community

## Propósito

El pipeline local ya produce agregados seguros y el outbox ya soporta operación offline. La pieza que faltaba era unir cola, autenticación de sensor y endpoint remoto sin introducir el token en los datos persistidos.

`CommunityDeliveryRuntime` fija una identidad de nodo y compone:

```text
CommunityUploadEnvelope
        ↓
verifica envelope.nodeId == runtime.nodeId
        ↓
CommunityOutboxStore
        ↓
flush
        ↓
NodeCredentialVault.get(nodeId)
        ↓
Authorization: Konta2rNode <token>
        ↓
ingest-community
```

## Identidad de una cola

Una instancia del runtime corresponde a un solo `nodeId` pseudónimo. Si intenta encolarse un envelope de otro nodo, la operación falla **antes de persistirlo**.

Esto evita que una cola configurada para una ventana/dispositivo termine transportando accidentalmente batches atribuidos a otro nodo.

## Credencial tardía

La credencial no se copia al `CommunityOutboxItem`. Se resuelve desde el vault durante cada intento HTTP.

Consecuencia útil: si la persona rota la credencial mientras existen batches pendientes, esos batches no deben reescribirse. El próximo `flush()` usa el token nuevo.

## Offline y reintentos

El comportamiento previo se mantiene:

- excepción de red → reintento con backoff y jitter;
- 408/425/429/5xx → reintento;
- errores de protocolo/cliente → dead letter;
- upload aceptado → se elimina de la cola.

Si no existe una credencial utilizable, el transporte devuelve un fallo local no retryable y el batch pasa a dead letter. Eso distingue una pérdida de conectividad de una pérdida/revocación de identidad del sensor. La recuperación de identidad requiere una persona autenticada y rotación/re-enrolamiento.

## Factory de navegador

`createBrowserCommunityDeliveryRuntime()` usa por defecto:

```text
Konta2rNodeSecretsDB   → credencial cifrada
Konta2rCommunityDB     → envelopes agregados + estado de cola
```

Las bases son deliberadamente distintas.

El endpoint se deriva de la configuración pública de Supabase:

```text
<VITE_SUPABASE_URL>/functions/v1/ingest-community
```

La publishable key no autentica al sensor en esta ruta; la identidad del nodo sigue siendo `Konta2rNode`. El endpoint de ingestión tiene `verify_jwt=false` precisamente para que el gateway no intente interpretar esa credencial como JWT humano.

## Snapshot operacional

El runtime expone solo estado técnico:

- `nodeId`;
- disponibilidad de credencial;
- batches pending;
- batches dead-letter.

No devuelve el token ni el ciphertext.

## Límites actuales

Este bloque verifica la composición lógica con stores en memoria y deja el factory real de IndexedDB typecheckeado. Todavía faltan pruebas end-to-end en navegador que combinen:

1. credencial cifrada real en IndexedDB;
2. cierre/reapertura de PWA;
3. batch acumulado offline;
4. reconexión;
5. llamada real a `ingest-community` en un proyecto Supabase de Konta2r.

Como todavía no existe ese proyecto dedicado, este runtime no debe describirse como validado contra backend real.
