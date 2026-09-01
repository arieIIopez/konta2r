import type {
  CommunityIngestionStore,
  CommunityPersistenceResult,
  NodeCredentialRow,
  NodeCredentialRowLookup,
  PreparedCommunityBatch,
} from './communityIngestion';

export interface SqlQueryResult<Row> {
  rows: Row[];
  rowCount: number;
}

export interface SqlExecutor {
  query<Row>(sql: string, params?: readonly unknown[]): Promise<SqlQueryResult<Row>>;
}

export interface TransactionalSqlExecutor extends SqlExecutor {
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

interface BatchIdentityRow {
  batch_id: string;
  payload_sha256: string;
}

interface CredentialLookupRow {
  node_id: string;
  segment_id: string;
  credential_hmac: string;
  key_version: number | string;
  node_status: string;
  expires_at_ms: number | string | null;
  revoked_at_ms: number | string | null;
}

function epochMs(value: number | string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveInteger(value: number | string): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function validNodeStatus(value: string): value is NodeCredentialRow['nodeStatus'] {
  return value === 'provisioning' || value === 'active' || value === 'paused' || value === 'revoked';
}

/**
 * Reads the credential record directly from PostgreSQL. This is server-only:
 * the private schema remains outside the Supabase Data API exposed schemas.
 */
export function createPostgresNodeCredentialLookup(db: SqlExecutor): NodeCredentialRowLookup {
  return async (nodeId) => {
    const result = await db.query<CredentialLookupRow>(`
      select
        n.node_id,
        n.segment_id,
        n.status as node_status,
        c.credential_hmac,
        c.key_version,
        extract(epoch from c.expires_at) * 1000 as expires_at_ms,
        extract(epoch from c.revoked_at) * 1000 as revoked_at_ms
      from public.nodes as n
      join private.node_credentials as c on c.node_id = n.node_id
      where n.node_id = $1
      limit 1
    `, [nodeId]);

    const row = result.rows[0];
    if (!row || !validNodeStatus(row.node_status)) return undefined;
    const keyVersion = positiveInteger(row.key_version);
    if (keyVersion === undefined || !/^[a-f0-9]{64}$/.test(row.credential_hmac)) return undefined;
    const expiresAtMs = epochMs(row.expires_at_ms);
    const revokedAtMs = epochMs(row.revoked_at_ms);
    if (row.expires_at_ms !== null && expiresAtMs === undefined) return undefined;
    if (row.revoked_at_ms !== null && revokedAtMs === undefined) return undefined;
    return {
      nodeId: row.node_id,
      segmentId: row.segment_id,
      credentialHmac: row.credential_hmac,
      keyVersion,
      nodeStatus: row.node_status,
      ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
      ...(revokedAtMs === undefined ? {} : { revokedAtMs }),
    };
  };
}

const INSERT_BATCH_SQL = `
  insert into private.community_batches (
    node_id,
    sequence,
    payload_sha256,
    generated_at,
    observed_segment_id,
    observed_segment_source,
    observed_segment_source_version,
    software_version,
    methodology_version,
    model_fingerprint,
    node_quality,
    runtime_summary
  ) values (
    $1,
    $2,
    $3,
    to_timestamp($4 / 1000.0),
    $5,
    $6,
    $7,
    $8,
    $9,
    $10,
    $11::jsonb,
    $12::jsonb
  )
  on conflict (node_id, sequence) do nothing
  returning batch_id::text, payload_sha256
`;

const FIND_EXISTING_BATCH_SQL = `
  select batch_id::text, payload_sha256
  from private.community_batches
  where node_id = $1 and sequence = $2
  limit 1
`;

const INSERT_FLOW_SQL = `
  insert into private.flow_aggregates (
    batch_id,
    bucket_start,
    bucket_end,
    entity_type,
    direction,
    count,
    mean_quality
  )
  select
    $1::uuid,
    to_timestamp(r.bucket_start_ms / 1000.0),
    to_timestamp(r.bucket_end_ms / 1000.0),
    r.entity_type,
    r.direction,
    r.count,
    r.mean_quality
  from jsonb_to_recordset($2::jsonb) as r(
    bucket_start_ms bigint,
    bucket_end_ms bigint,
    entity_type text,
    direction text,
    count integer,
    mean_quality double precision
  )
`;

const INSERT_SPATIAL_SQL = `
  insert into private.spatial_aggregates (
    batch_id,
    bucket_start,
    bucket_end,
    cell_x,
    cell_y,
    cell_size_meters,
    entity_type,
    unique_entities,
    sample_count,
    mean_speed_mps,
    mean_quality
  )
  select
    $1::uuid,
    to_timestamp(r.bucket_start_ms / 1000.0),
    to_timestamp(r.bucket_end_ms / 1000.0),
    r.cell_x,
    r.cell_y,
    r.cell_size_meters,
    r.entity_type,
    r.unique_entities,
    r.sample_count,
    r.mean_speed_mps,
    r.mean_quality
  from jsonb_to_recordset($2::jsonb) as r(
    bucket_start_ms bigint,
    bucket_end_ms bigint,
    cell_x integer,
    cell_y integer,
    cell_size_meters double precision,
    entity_type text,
    unique_entities integer,
    sample_count integer,
    mean_speed_mps double precision,
    mean_quality double precision
  )
`;

const TOUCH_CREDENTIAL_SQL = `
  update private.node_credentials
  set last_used_at = now()
  where node_id = $1
`;

function flowRows(batch: PreparedCommunityBatch): string {
  return JSON.stringify(batch.envelope.records.flatMap((record) => (
    record.aggregateType !== 'flow'
      ? []
      : [{
          bucket_start_ms: record.bucketStartMs,
          bucket_end_ms: record.bucketEndMs,
          entity_type: record.entityType,
          direction: record.direction,
          count: record.count,
          mean_quality: record.meanQuality,
        }]
  )));
}

function spatialRows(batch: PreparedCommunityBatch): string {
  return JSON.stringify(batch.envelope.records.flatMap((record) => (
    record.aggregateType !== 'spatial'
      ? []
      : [{
          bucket_start_ms: record.bucketStartMs,
          bucket_end_ms: record.bucketEndMs,
          cell_x: record.cellX,
          cell_y: record.cellY,
          cell_size_meters: record.cellSizeMeters,
          entity_type: record.entityType,
          unique_entities: record.uniqueEntities,
          sample_count: record.sampleCount,
          mean_speed_mps: record.meanSpeedMps ?? null,
          mean_quality: record.meanQuality,
        }]
  )));
}

async function insertAggregates(tx: SqlExecutor, batchId: string, batch: PreparedCommunityBatch): Promise<void> {
  const flow = batch.envelope.records.some((record) => record.aggregateType === 'flow');
  const spatial = batch.envelope.records.some((record) => record.aggregateType === 'spatial');
  if (flow) await tx.query(INSERT_FLOW_SQL, [batchId, flowRows(batch)]);
  if (spatial) await tx.query(INSERT_SPATIAL_SQL, [batchId, spatialRows(batch)]);
}

async function touchCredential(tx: SqlExecutor, nodeId: string): Promise<void> {
  await tx.query(TOUCH_CREDENTIAL_SQL, [nodeId]);
}

/**
 * PostgreSQL implementation of CommunityIngestionStore.
 *
 * The unique constraint on (node_id, sequence) is the concurrency primitive.
 * INSERT ... ON CONFLICT DO NOTHING atomically elects one writer. A subsequent
 * SELECT distinguishes an identical retry from an idempotency conflict without
 * a race-prone application-level read-before-insert sequence.
 */
export function createPostgresCommunityIngestionStore(
  db: TransactionalSqlExecutor,
): CommunityIngestionStore {
  return {
    async persist(batch): Promise<CommunityPersistenceResult> {
      return db.transaction(async (tx) => {
        const generatedAtMs = Date.parse(batch.envelope.generatedAtIso);
        if (!Number.isFinite(generatedAtMs)) throw new Error('Invalid generatedAtIso reached persistence boundary');

        const insert = await tx.query<BatchIdentityRow>(INSERT_BATCH_SQL, [
          batch.nodeId,
          batch.sequence,
          batch.payloadSha256,
          generatedAtMs,
          batch.envelope.observedSegment.segmentId,
          batch.envelope.observedSegment.source,
          batch.envelope.observedSegment.sourceVersion ?? null,
          batch.envelope.softwareVersion,
          batch.envelope.methodologyVersion,
          batch.envelope.modelFingerprint,
          JSON.stringify(batch.envelope.quality),
          JSON.stringify(batch.envelope.runtime),
        ]);

        const inserted = insert.rows[0];
        if (inserted) {
          await insertAggregates(tx, inserted.batch_id, batch);
          await touchCredential(tx, batch.nodeId);
          return { status: 'inserted', batchId: inserted.batch_id };
        }

        const existingResult = await tx.query<BatchIdentityRow>(FIND_EXISTING_BATCH_SQL, [
          batch.nodeId,
          batch.sequence,
        ]);
        const existing = existingResult.rows[0];
        if (!existing) {
          throw new Error('Community idempotency invariant violated: conflict row not visible');
        }
        if (existing.payload_sha256 !== batch.payloadSha256) {
          return {
            status: 'conflict',
            existingPayloadSha256: existing.payload_sha256,
          };
        }

        await touchCredential(tx, batch.nodeId);
        return { status: 'duplicate_same_payload', batchId: existing.batch_id };
      });
    },
  };
}
