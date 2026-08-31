# Custodia local de credenciales de nodo

## Objetivo

Un nodo Community necesita conservar su credencial entre reinicios para poder operar sin una persona frente al dispositivo. Esa persistencia no debe convertir el token en un dato común de la aplicación.

Konta2r separa tres cosas:

1. **payload Community**: solo agregados y metadata metodológica;
2. **outbox**: guarda envelopes y estado de reintento, nunca autorización;
3. **vault local**: única capa persistente autorizada para custodiar la credencial del sensor.

El transporte obtiene el token desde el vault justo antes de construir `Authorization: Konta2rNode ...`.

## Qué protege este diseño

La implementación usa AES-GCM de 256 bits y una `CryptoKey` no exportable almacenada mediante structured clone en IndexedDB. Cada credencial se cifra con un IV de 96 bits y authenticated additional data que incluye:

```text
schema del vault | nodeId | keyVersion
```

Esto aporta principalmente:

- ausencia de token raw en `localStorage` / `sessionStorage`;
- ausencia de token raw en outbox y payloads Community;
- ausencia de token raw en el registro persistente del vault;
- detección de modificaciones de `nodeId`, `keyVersion`, IV o ciphertext mediante AES-GCM;
- separación entre la versión criptográfica local del vault y la versión de pepper usada por el backend;
- eliminación local de la credencial después de revocación confirmada.

## Qué NO protege

Este mecanismo **no es una defensa contra JavaScript arbitrario ejecutándose con control del mismo origen**. Una vulnerabilidad XSS o una extensión con capacidad suficiente podría intentar usar las APIs de IndexedDB/WebCrypto aunque la clave sea no exportable.

`extractable: false` significa que la clave no puede exportarse como bytes mediante `SubtleCrypto.exportKey()`. No significa que una página comprometida no pueda solicitar operaciones de cifrado/descifrado con esa clave.

Por eso la seguridad real sigue dependiendo también de:

- evitar inyección de scripts;
- CSP y política de dependencias cuando se despliegue el sitio productivo;
- no cargar JavaScript remoto innecesario;
- mantener dependencias fijadas y auditables;
- proteger el origen HTTPS y el dispositivo físico.

## Estructura IndexedDB

Base separada:

```text
Konta2rNodeSecretsDB
  ├── keys
  │    └── node-credential-aes-gcm-v1 → CryptoKey no exportable
  └── credentials
       └── <nodeId> → {
             schemaVersion,
             nodeId,
             keyVersion,
             iv,
             ciphertext,
             storedAtMs
           }
```

No existe un campo persistido `credential`.

La base del vault se mantiene separada de `Konta2rCommunityDB`, donde vive el outbox, para que una exportación/inspección de la cola no incluya material de autenticación.

## Lectura fail-closed

Si existe ciphertext pero desaparece la `CryptoKey`, una lectura **no genera una nueva clave**. La credencial se considera no disponible.

Crear una clave nueva en esa situación sería engañoso: nunca podría descifrar el registro existente. La recuperación debe ocurrir mediante la identidad humana y una nueva rotación de credencial.

## Enrolamiento

```text
node-enroll
   ↓
respuesta contiene token una sola vez
   ↓
NodeControlClient valida formato + versión
   ↓
AES-GCM
   ↓
IndexedDbNodeCredentialVault.put()
   ↓
la UI recibe solo metadata + credentialStored=true
```

Si el servidor enrola correctamente pero el dispositivo no puede guardar el token, el cliente falla sin incluir el secreto en el mensaje de error. El usuario autenticado puede abandonar ese provisioning y enrolar nuevamente.

## Rotación

```text
node-lifecycle(action=rotate)
   ↓
servidor invalida/reemplaza HMAC anterior
   ↓
retorna token nuevo una sola vez
   ↓
vault reemplaza ciphertext del mismo nodeId
```

La rotación conserva el `nodeId`.

Existe una ventana de fallo inevitable con el protocolo actual: el servidor puede completar la rotación y luego fallar IndexedDB. En ese caso el token anterior ya no sirve. La recuperación es ejecutar otra rotación mediante la sesión humana; no se debe intentar recuperar el token desde logs, historial o backend porque nunca se almacena raw.

Una futura necesidad de rotación completamente transaccional entre nube y navegador requeriría un protocolo de dos fases o generaciones de credencial con periodo de gracia. No se simula esa garantía en esta versión.

## Revocación

El servidor es la autoridad. Tras un `revoke` exitoso, el cliente intenta eliminar el ciphertext local.

Si la eliminación local falla:

- la credencial ya está revocada en backend y no puede ingerir;
- el cliente reporta fallo de limpieza para permitir reintento;
- nunca se considera la presencia local de ciphertext como señal de autorización vigente.

## Transporte

`createCommunityHttpSender()` conserva su contrato de proveedor tardío:

```ts
nodeCredential: () => Promise<string | undefined>
```

La integración recomendada es:

```text
IndexedDbNodeCredentialVault
          ↓
createVaultBackedNodeCredentialProvider(vault, nodeId)
          ↓
createCommunityHttpSender(...)
```

Así la cola no necesita conocer el secreto y el token permanece en memoria únicamente durante la lectura/call HTTP correspondiente.

## Límites de validación actuales

Las primitivas criptográficas y los contratos se cubren con unit tests y TypeScript. El adaptador IndexedDB se valida estructuralmente en CI, pero todavía falta probarlo en navegadores/dispositivos reales, incluyendo:

- Chrome/Android en teléfonos antiguos;
- Safari/iOS/PWA;
- persistencia después de reinicio;
- eliminación de site data;
- almacenamiento bajo presión/eviction;
- structured clone de `CryptoKey` no exportable.

Hasta esas pruebas no debe describirse el vault como validado en todos los navegadores objetivo.
