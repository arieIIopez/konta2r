import { describe, expect, it } from 'vitest';
import schemaSql from '../../supabase/schema.sql?raw';

describe('Supabase schema privacy policy', () => {
  it('keeps node credentials, lifecycle audit and Community ingest outside the exposed schema', () => {
    expect(schemaSql).toContain('create schema if not exists private');
    expect(schemaSql).toContain('create table if not exists private.node_credentials');
    expect(schemaSql).toContain('create table if not exists private.node_lifecycle_events');
    expect(schemaSql).toContain('create table if not exists private.community_batches');
    expect(schemaSql).toContain('create table if not exists private.flow_aggregates');
    expect(schemaSql).toContain('revoke all on all tables in schema private from public, anon, authenticated');
  });

  it('requires RLS and explicit least-privilege grants on browser-reachable tables', () => {
    expect(schemaSql).toContain('alter table public.profiles enable row level security');
    expect(schemaSql).toContain('alter table public.segments enable row level security');
    expect(schemaSql).toContain('alter table public.nodes enable row level security');
    expect(schemaSql).toContain('using ((select auth.uid()) = owner_user_id)');
    expect(schemaSql).toContain('grant select on table public.segments to anon, authenticated');
    expect(schemaSql).not.toContain('grant insert, update, delete on table public.segments to anon');
  });

  it('makes the node registry read-only to browser roles so enrollment/lifecycle cannot bypass server checks', () => {
    expect(schemaSql).toContain('grant select on table public.nodes to authenticated');
    expect(schemaSql).not.toContain('grant select, insert, update on table public.nodes to authenticated');
    expect(schemaSql).not.toContain('nodes_insert_own');
    expect(schemaSql).not.toContain('nodes_update_own');
    expect(schemaSql).toContain("(status = 'revoked') = (revoked_at is not null)");
  });

  it('records lifecycle audit evidence without persisting raw credential material', () => {
    expect(schemaSql).toContain("action in ('activate', 'pause', 'revoke', 'rotate')");
    expect(schemaSql).toContain('previous_status text not null');
    expect(schemaSql).toContain('next_status text not null');
    expect(schemaSql).toContain('credential_key_version smallint');
    expect(schemaSql).not.toMatch(/raw_(credential|token)|credential_secret|node_secret/i);
  });

  it('stores only a HMAC fingerprint for node credentials', () => {
    expect(schemaSql).toContain('credential_hmac text not null');
    expect(schemaSql).not.toMatch(/raw_(credential|token)|credential_secret|node_secret/i);
  });

  it('binds idempotency to both node sequence and canonical payload identity', () => {
    expect(schemaSql).toContain('payload_sha256 text not null');
    expect(schemaSql).toContain("payload_sha256 ~ '^[a-f0-9]{64}$'");
    expect(schemaSql).toContain('unique (node_id, sequence)');
  });

  it('models segments rather than a precise node/home point', () => {
    expect(schemaSql).toContain('geometry extensions.geometry(LineString, 4326)');
    expect(schemaSql).toContain('segment_id text references public.segments');
    expect(schemaSql).not.toMatch(/node_(latitude|longitude|address)|home_(latitude|longitude|address)/i);
  });
});
