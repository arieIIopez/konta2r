# Dedicated Supabase deployment for Konta2r

## Status

This runbook prepares the first **dedicated Konta2r Supabase project**. It must not be applied to an unrelated Supabase project.

The repository is deploy-ready at the code level, but a live deployment still requires three external actions that must not be faked in CI or committed to Git:

1. create/select the dedicated Supabase project;
2. configure the custom node-credential pepper as an Edge Function secret;
3. configure Google OAuth for human administration.

The Community sensor path does **not** use a human session. Google/Supabase Auth is only for enrollment and lifecycle administration.

## Region

For the Santiago/Chile pilot, use `sa-east-1` unless there is an organizational requirement to host elsewhere. The deployment region is infrastructure metadata only; it does not change the privacy boundary: raw frames, tracks and exact household coordinates remain local.

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

Hosted Edge Functions receive the platform variables automatically, including:

- `SUPABASE_URL`;
- `SUPABASE_DB_URL`;
- `SUPABASE_PUBLISHABLE_KEYS`;
- `SUPABASE_SECRET_KEYS`;
- `SUPABASE_JWKS`.

`SUPABASE_PUBLISHABLE_KEYS` is a JSON dictionary whose `default` value is the actual publishable key. `supabaseAuth.ts` intentionally reads that value directly, with local `SUPABASE_PUBLISHABLE_KEY` and legacy `SUPABASE_ANON_KEY` compatibility fallbacks.

## Edge Function authorization

`supabase/config.toml` fixes the intended gateway policy:

| Function | Caller | `verify_jwt` | Application-level check |
| --- | --- | ---: | --- |
| `node-enroll` | signed-in human | `true` | re-resolve user via Supabase Auth `/auth/v1/user` |
| `node-lifecycle` | signed-in human | `true` | re-resolve user via Supabase Auth `/auth/v1/user` |
| `ingest-community` | Konta2r sensor | `false` | `Authorization: Konta2rNode <credential>` + HMAC verification |

`ingest-community` must remain `verify_jwt=false`: its credential is intentionally not a Supabase user JWT. This does **not** make the endpoint unauthenticated; Konta2r authenticates the sensor inside the handler.

## Custom function secrets

Start from `supabase/functions/.env.example`.

The minimum custom keyring is:

```text
KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION=1
KONTA2R_NODE_TOKEN_PEPPER_V1=<random secret>
```

Generate the pepper locally on a trusted machine, for example with a cryptographic random generator. Do not paste the value into chat, issues, commits or browser environment variables.

Rotation is versioned:

1. add a new `KONTA2R_NODE_TOKEN_PEPPER_VN` while the previous pepper remains present;
2. change `KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION` to `N`;
3. rotate node credentials through the authenticated lifecycle endpoint;
4. remove an old pepper only after the database contains no live credential using that key version.

## Database bootstrap

`supabase/schema.sql` is the reviewed initial schema source, not a fabricated migration file.

Deployment sequence:

1. apply the schema to the new empty project using the Supabase database tool/CLI workflow;
2. verify `public.profiles`, `public.segments`, `public.nodes` and the private credential/audit/aggregate tables;
3. verify RLS/grants;
4. run Supabase Security Advisor and Performance Advisor;
5. fix findings before treating the deployment as valid;
6. only after validation, create/record the canonical migration history using the current Supabase CLI workflow.

Do not invent migration timestamps by hand.

## Required privacy properties after bootstrap

The database must preserve all of these properties:

- `private` is not exposed to `anon` or `authenticated`;
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
- the referenced `src/backend/*`, `src/community/*`, `src/core/*` dependencies required by each function;
- `supabase/functions/deno.json`.

After deployment, inspect the deployed function list and function versions. Do not infer success merely from an API response.

## Non-destructive HTTP smoke test

After project URL, publishable key, schema and functions exist, run:

```bash
KONTA2R_E2E_SUPABASE_URL='https://<ref>.supabase.co' \
KONTA2R_E2E_PUBLISHABLE_KEY='sb_publishable_...' \
npm run smoke:supabase
```

The probe does not create rows. It verifies:

1. `node-enroll` rejects a caller without a human JWT;
2. `node-lifecycle` rejects a caller without a human JWT;
3. `ingest-community` accepts the request far enough to execute Konta2r policy, then rejects the missing `Konta2rNode` credential with `invalid_node_auth`.

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

- dedicated project exists;
- schema is live and advisors reviewed;
- custom pepper secret is configured;
- all three Edge Functions are deployed with intended JWT policy;
- smoke probe passes;
- Google human login works;
- full lifecycle E2E passes;
- SQL evidence confirms idempotency, rotation, pause and revocation semantics;
- frontend uses only project URL + publishable key;
- no unrelated Supabase project was modified.
