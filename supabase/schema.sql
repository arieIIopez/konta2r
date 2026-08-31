-- Konta2r Supabase schema prototype.
-- This file is intentionally NOT a migration: when a Konta2r Supabase project
-- exists, create the first migration with the Supabase CLI and copy/review this
-- schema into that generated migration file.
--
-- Security principles:
-- 1. Google/Supabase Auth identifies humans; auth.uid() owns user-facing rows.
-- 2. A Konta2r node has its own revocable credential, never a long-lived human session.
-- 3. Raw video, frames, tracks and exact household coordinates are not backend data.
-- 4. Node credentials and incoming aggregate batches live in a non-exposed schema.
-- 5. Data API object grants and RLS are both explicit.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

-- Move the project toward an opt-in Data API posture. Existing grants are handled
-- explicitly below; future objects should not become public APIs by accident.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, public;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (
    display_name is null or char_length(display_name) between 1 and 120
  )
);

comment on table public.profiles is
  'Konta2r application profile keyed by Supabase Auth user id. Authorization must never rely on editable Google/user metadata.';

create table if not exists public.segments (
  segment_id text primary key,
  source text not null,
  source_version text,
  segment_kind text not null,
  geometry extensions.geometry(LineString, 4326),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint segments_id_nonempty check (char_length(trim(segment_id)) between 1 and 160),
  constraint segments_source check (source in ('osm', 'konta2r', 'municipal', 'other')),
  constraint segments_kind check (segment_kind in ('road', 'cycleway', 'sidewalk', 'shared', 'other'))
);

comment on table public.segments is
  'Observed street/cycleway/sidewalk reference. Nodes associate to a segment instead of publishing an exact household coordinate.';

create index if not exists segments_geometry_gix
  on public.segments using gist (geometry);

create table if not exists public.nodes (
  node_id text primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  segment_id text references public.segments(segment_id) on update cascade on delete set null,
  status text not null default 'provisioning',
  software_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint nodes_pseudonymous_id check (node_id ~ '^node_[A-Za-z0-9_-]{6,80}$'),
  constraint nodes_label_length check (char_length(trim(label)) between 1 and 120),
  constraint nodes_status check (status in ('provisioning', 'active', 'paused', 'revoked')),
  constraint nodes_revocation_consistency check (
    (status = 'revoked' and revoked_at is not null)
    or (status <> 'revoked')
  )
);

comment on table public.nodes is
  'Pseudonymous sensor registry. The owner relationship is private to the authenticated account and is never part of Community payloads.';

create index if not exists nodes_owner_user_id_idx on public.nodes(owner_user_id);
create index if not exists nodes_segment_id_idx on public.nodes(segment_id);

-- The browser/node never reads this table directly. Store a keyed HMAC/fingerprint,
-- not a raw node token. The HMAC key belongs in an Edge Function secret.
create table if not exists private.node_credentials (
  node_id text primary key references public.nodes(node_id) on delete cascade,
  credential_hmac text not null,
  key_version smallint not null default 1,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint node_credentials_hmac_hex check (credential_hmac ~ '^[a-f0-9]{64}$'),
  constraint node_credentials_key_version check (key_version > 0),
  constraint node_credentials_expiry check (expires_at is null or expires_at > created_at)
);

comment on table private.node_credentials is
  'HMAC-SHA256 fingerprints of high-entropy node credentials. Raw credentials must never be stored.';

-- One row per Community upload envelope. The protocol already excludes raw video,
-- frames, track/session identifiers, precise lat/lon, faces, plates and embeddings.
create table if not exists private.community_batches (
  batch_id uuid primary key default gen_random_uuid(),
  node_id text not null references public.nodes(node_id) on delete restrict,
  sequence bigint not null,
  generated_at timestamptz not null,
  observed_segment_id text not null references public.segments(segment_id) on update cascade on delete restrict,
  observed_segment_source text not null,
  observed_segment_source_version text,
  software_version text not null,
  methodology_version text not null,
  model_fingerprint text not null,
  node_quality jsonb not null,
  runtime_summary jsonb not null,
  received_at timestamptz not null default now(),
  constraint community_batches_sequence check (sequence >= 0),
  constraint community_batches_segment_source check (
    observed_segment_source in ('osm', 'konta2r', 'municipal', 'other')
  ),
  constraint community_batches_node_sequence_unique unique (node_id, sequence)
);

create index if not exists community_batches_segment_generated_idx
  on private.community_batches(observed_segment_id, generated_at desc);
create index if not exists community_batches_node_received_idx
  on private.community_batches(node_id, received_at desc);

create table if not exists private.flow_aggregates (
  aggregate_id bigint generated always as identity primary key,
  batch_id uuid not null references private.community_batches(batch_id) on delete cascade,
  bucket_start timestamptz not null,
  bucket_end timestamptz not null,
  entity_type text not null,
  direction text not null,
  count integer not null,
  mean_quality double precision not null,
  constraint flow_bucket_order check (bucket_end > bucket_start),
  constraint flow_bucket_public_floor check (bucket_end - bucket_start >= interval '1 minute'),
  constraint flow_direction check (direction in ('A_TO_B', 'B_TO_A', 'UNSPECIFIED')),
  constraint flow_count check (count >= 0),
  constraint flow_quality check (mean_quality between 0 and 1)
);

create index if not exists flow_aggregates_batch_idx on private.flow_aggregates(batch_id);
create index if not exists flow_aggregates_bucket_idx on private.flow_aggregates(bucket_start, entity_type);

create table if not exists private.spatial_aggregates (
  aggregate_id bigint generated always as identity primary key,
  batch_id uuid not null references private.community_batches(batch_id) on delete cascade,
  bucket_start timestamptz not null,
  bucket_end timestamptz not null,
  cell_x integer not null,
  cell_y integer not null,
  cell_size_meters double precision not null,
  entity_type text not null,
  unique_entities integer not null,
  sample_count integer not null,
  mean_speed_mps double precision,
  mean_quality double precision not null,
  constraint spatial_bucket_order check (bucket_end > bucket_start),
  constraint spatial_bucket_public_floor check (bucket_end - bucket_start >= interval '1 minute'),
  constraint spatial_cell_size check (cell_size_meters >= 2),
  constraint spatial_unique_entities check (unique_entities >= 0),
  constraint spatial_sample_count check (sample_count >= 0),
  constraint spatial_speed check (mean_speed_mps is null or mean_speed_mps >= 0),
  constraint spatial_quality check (mean_quality between 0 and 1)
);

create index if not exists spatial_aggregates_batch_idx on private.spatial_aggregates(batch_id);
create index if not exists spatial_aggregates_bucket_idx on private.spatial_aggregates(bucket_start, entity_type);

-- RLS: every Data API reachable table is protected.
alter table public.profiles enable row level security;
alter table public.segments enable row level security;
alter table public.nodes enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "segments_public_read"
  on public.segments for select
  to anon, authenticated
  using (true);

create policy "nodes_select_own"
  on public.nodes for select
  to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy "nodes_insert_own"
  on public.nodes for insert
  to authenticated
  with check ((select auth.uid()) = owner_user_id);

create policy "nodes_update_own"
  on public.nodes for update
  to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

-- Object reachability is explicit and intentionally narrower than service-role access.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.nodes from anon, authenticated;
revoke all on table public.segments from anon, authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update on table public.nodes to authenticated;
grant select on table public.segments to anon, authenticated;

-- Private schema stays unreachable through the normal browser roles.
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

commit;
