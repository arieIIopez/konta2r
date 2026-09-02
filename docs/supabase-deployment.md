# Dedicated Supabase deployment for Konta2r

## Status

Konta2r now has a **dedicated Supabase project** in the `arieIIopez` organization:

- project: `konta2r`;
- project ref: `skfraobbnbjpefqtnuqk`;
- region: `sa-east-1` (São Paulo);
- organization plan: `free`;
- Supabase development branches: none.

The unrelated pre-existing Supabase project must never be used for Konta2r.

At the current deployment stage the initial schema is live, Security Advisor is clean, and the human enrollment/lifecycle Edge Functions have been deployed. Google OAuth and the final positive lifecycle E2E remain external gates.

The Community sensor path does **not** use a human session. Google/Supabase Auth is only for enrollment and lifecycle administration.

## Cost guardrail

The pilot is intentionally designed to remain inside the Supabase Free plan:

- do not create Supabase development branches unless their current cost is explicitly reviewed and approved;
- do not enable paid add-ons, read replicas, PITR, custom domains, or other paid infrastructure without explicit approval;
- keep raw video, frames and tracks on-device, which also avoids backend storage/egress growth;
- Community uploads contain only coarse aggregates;
- check the current Supabase plan/usage limits before any scale-out change.

A Free-plan configuration cannot guarantee that a third-party vendor will never change prices or limits in the future. Any future infrastructure change that could create cost must therefore be treated as a separate approval gate.

## Region

For the Santiago/Chile pilot use `sa-east-1`. The deployment region is infrastructure metadata only; it does not change the privacy boundary: raw frames, tracks and exact household coordinates remain local.

## Current auth/key model

Konta2r uses modern Supabase publishable keys in the browser:

- `VITE_SUPABASE_URL`;
- `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`.

Never place any of the following in a `VITE_*` variable:

- `sb_secret_*`;
- legacy `service_role`;
- database passwords/connection strings;
- node credential peppers;
- Google OAuth client secret.

Hosted Edge Functions receive the platform variables automatically, including `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` and `SUPABASE_JWKS`.

`SUPABASE_PUBLISHABLE_KEYS` is a JSON dictionary whose `default` value is the actual publishable key. `supabaseAuth.ts` reads that value directly, with local `SUPABASE_PUBLISHABLE_KEY` and legacy `SUPABASE_ANON_KEY` compatibility fallbacks.

## Edge Function authorization

`supabase/config.toml` fixes the intended gateway policy:

| Function | Caller | `verify_jwt` | Application-level check |
| --- | --- | ---: | --- |
| `node-enroll` | signed-in human | `true` | re-resolve user via Supabase Auth `/auth/v1/user` |
| `node-lifecycle` | signed-in human | `true` | re-resolve user via Supabase Auth `/auth/v1/user` |
| `ingest-community` | Konta2r sensor | `false` | `Authorization: Konta2rNode <credential>` + HMAC verification |

`ingest-community` must remain `verify_jwt=false`: its credential is intentionally not a Supabase user JWT. This does **not** make the endpoint unauthenticated; Konta2r authenticates the sensor inside the handler.

## Node credential pepper: Supabase Vault

Node credentials are HMAC-SHA256 fingerprints. Their server pepper is **not an environment variable and is never committed**.

`supabase/vault.sql` bootstraps the keyring:

1. ensure Supabase Vault is available;
2. revoke browser-role access to Vault secret/decrypted-secret objects;
3. generate 48 random bytes inside Postgres with `extensions.gen_random_bytes(48)`;
4. pass the generated value directly to `vault.create_secret(...)` under the name `konta2r_node_token_pepper_v1`;
5. store only Vault's encrypted representation on disk/backups.

The Edge Functions query `vault.decrypted_secrets` using their direct privileged Postgres connection. The plaintext pepper therefore never appears in Git, frontend variables, migrations, chat, or application logs.

`KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION` defaults to `1`. It is only needed as an Edge Function environment override during a future rotation.

Rotation is versioned:

1. create `konta2r_node_token_pepper_vN` in Vault with fresh database-generated randomness while the previous version remains present;
2. set `KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION=N` for the Edge Functions;
3. rotate node credentials through the authenticated lifecycle endpoint;
4. remove an old Vault secret only after no live credential uses that key version.

## Database bootstrap

`supabase/schema.sql` is the reviewed initial schema source. `supabase/vault.sql` is the reviewed server-secret bootstrap source.

Deployment sequence:

1. apply the initial schema to the dedicated empty project;
2. apply `supabase/vault.sql`;
3. verify `public.profiles`, `public.segments`, `public.nodes` and private credential/audit/aggregate tables;
4. verify RLS/grants;
5. run Supabase Security Advisor and Performance Advisor;
6. fix security findings before treating the deployment as valid.

Do not invent migration timestamps by hand. When local Supabase CLI migration history is introduced, create migration files with the current CLI workflow rather than fabricating filenames.

## Required privacy properties after bootstrap

The database must preserve all of these properties:

- `private` is not exposed to `anon` or `authenticated`;
- Vault decrypted secrets are not exposed to `anon` or `authenticated`;
- raw node credentials are never stored, only HMAC-SHA256 fingerprints;
- lifecycle audit events are append-only application evidence;
- Community batches are idempotent by `(node_id, sequence)`;
- aggregate tables contain no frame, bounding box, track id, event id, exact crossing coordinate or exact household coordinate;
- browser users cannot directly create or mutate nodes through the Data API;
- a user can read only their own node registry rows;
- public segment references represent observed network segments rather than household locations.

## Edge Function deployment

Deploy all relative dependencies together with each entrypoint:

- `node-enroll`;
- `node-lifecycle`;
- `ingest-community`;
- `supabase/functions/_shared/*`;
- referenced `src/backend/*`, `src/community/*`, `src/core/*` dependencies;
- `supabase/functions/deno.json`.

After deployment inspect the deployed function list and versions. Do not infer success merely from an API response.

## Non-destructive HTTP smoke test

After project URL, publishable key, schema, Vault and functions exist, run:

```bash
KONTA2R_E2E_SUPABASE_URL='https://<ref>.supabase.co' \
KONTA2R_E2E_PUBLISHABLE_KEY='sb_publishable_...' \
npm run smoke:supabase
```

The probe does not create rows. It verifies:

1. `node-enroll` rejects a caller without a human JWT;
2. `node-lifecycle` rejects a caller without a human JWT;
3. `ingest-community` reaches Konta2r policy and rejects a missing `Konta2rNode` credential.

A failure here blocks the full E2E test.

## Google OAuth gate

Human enrollment requires the Google provider in Supabase Auth.

Configure in the Supabase/Google consoles, not in Git:

- Google OAuth Web client ID;
- Google OAuth client secret;
- authorized JavaScript origin for the Konta2r frontend;
- Supabase callback URI shown by the Google provider configuration;
- Supabase Site URL and allowed redirect URL(s) for the deployed app/local pilot.

The browser requests only `openid email profile`.

Never ask an operator to paste the Google client secret into a Konta2r browser or repository file.

## Positive lifecycle E2E

Before running the positive test, create one disposable segment row in `public.segments`, e.g. a `konta2r` source segment with no exact household geometry.

Obtain a **short-lived Supabase user access token locally** by signing into the pilot. Do not paste that token into chat or commit it.

Then run locally:

```bash
KONTA2R_E2E_SUPABASE_URL='https://<ref>.supabase.co' \
KONTA2R_E2E_PUBLISHABLE_KEY='sb_publishable_...' \
KONTA2R_E2E_USER_JWT='<short-lived user JWT>' \
KONTA2R_E2E_SEGMENT_ID='segment_e2e_01' \
npm run e2e:supabase
```

The script intentionally creates one disposable audited node and checks:

1. human enrollment returns a one-time sensor credential;
2. activation succeeds;
3. sensor aggregate sequence 1 is accepted;
4. exact replay is idempotently accepted as a duplicate;
5. altered payload with the same sequence is rejected as a conflict;
6. credential rotation returns a new credential;
7. the old credential is rejected;
8. the rotated credential is accepted;
9. a paused node is rejected;
10. reactivation restores ingest;
11. revocation is terminal for ingest.

The script never prints the user JWT or raw node credentials. It revokes the disposable node at the end but retains database audit/batch evidence as E2E proof.

## Database verification after positive E2E

Verify with server-side SQL only:

- one owner-bound `public.nodes` row exists for the E2E node and ends `revoked`;
- credential `key_version` matches the rotation result and raw credentials are absent;
- lifecycle audit contains activate/rotate/pause/activate/revoke in order;
- accepted sequences appear once each in `private.community_batches`;
- replay does not create a second batch;
- conflict does not overwrite the original batch;
- `private.flow_aggregates` contains only aggregate records.

Then run both Supabase advisors again.

## Browser configuration

Only after backend validation:

```text
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

A standard build without these variables remains local-only. A build with them exposes Community administration and delivery, but local counting must continue to work if Community is unavailable.

## Deployment acceptance gate

Konta2r may call the backend integration **deployed and E2E-verified** only when all of the following are true:

- dedicated Free-plan project exists;
- schema and Vault keyring are live and advisors reviewed;
- all three Edge Functions are deployed with intended JWT policy;
- smoke probe passes;
- Google human login works;
- full lifecycle E2E passes;
- SQL evidence confirms idempotency, rotation, pause and revocation semantics;
- frontend uses only project URL + publishable key;
- no unrelated Supabase project was modified;
- no paid Supabase feature was enabled without explicit approval.
