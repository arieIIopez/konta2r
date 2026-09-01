import { describe, expect, it } from 'vitest';
import {
  createPostgresCommunityIngestionStore,
  createPostgresNodeCredentialLookup,
  type SqlExecutor,
  type SqlQueryResult,
  type TransactionalSqlExecutor,
} from '../../src/backend/postgresCommunityStore';
import { computeNodeQuality } from '../../src/community/quality';
import type { CommunityUploadEnvelope } from '../../src/community/protocol';
import type { PreparedCommunityBatch } from '../../src/backend/communityIngestion';

interface RecordedQuery {
  sql: string;
  params: readonly unknown[];
}

type QueryResponder = (
  sql: string,
  params: readonly unknown[],
  callIndex: number,
) => SqlQueryResult<unknown> | Promise<SqlQueryResult<unknown>>;

class FakeDatabase implements TransactionalSqlExecutor {
  readonly queries: RecordedQuery[] = [];
  transactionCalls = 0;
  committed = 0;
  rolledBack = 0;

  constructor(private readonly responder: QueryResponder) {}

  async query<Row>(sql: string, params: readonly unknown[] = []): Promise<SqlQueryResult<Row>> {
    this.queries.push({ sql, params });
    const result = await this.responder(sql, params, this.queries.length - 1);
    return result as SqlQueryResult<Row>;
  }

  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    try {
      const result = await work(this);
      this.committed += 1;
      return result;
    } catch (error) {
      this.rolledBack += 1;
      throw error;
    }
  }
}

function result<Row>(rows: Row[]): SqlQueryResult<Row> {
  return { rows, rowCount: rows.length };
}

function envelope(): CommunityUploadEnvelope {
  return {
    schemaVersion: '2.0',
    nodeId: 'node_abc12345',
    sequence: 42,
    generatedAtIso: '2026-09-01T04:10:00.000Z',
    observedSegment: {
      segmentId: 'osm_way_123:segment_4',
      source: 'osm',
      sourceVersion: '2026-08',
    },
    softwareVersion: '2.0.0-alpha.1',
    methodologyVersion: '2.0',
    modelFingerprint: 'sha256:detector-baseline',
    quality: computeNodeQuality({
      detection: 0.9,
      tracking: 0.88,
      temporal: 0.95,
      device: 0.9,
      validation: 0.86,
    }),
    runtime: {
      uptimeRatio: 0.98,
      inferenceFpsP50: 5.1,
      inferenceLatencyP95Ms: 180,
      droppedFrameRatio: 0.04,
      runtimeBackend: 'wasm',
    },
    records: [
      {
        schemaVersion: '2.0',
        aggregateType: 'flow',
        bucketStartMs: 1_788_000_000_000,
        bucketEndMs: 1_788_000_300_000,
        entityType: 'cyclist',
        direction: 'A_TO_B',
        count: 12,
        meanQuality: 0.87,
      },
      {
        schemaVersion: '2.0',
        aggregateType: 'spatial',
        bucketStartMs: 1_788_000_000_000,
        bucketEndMs: 1_788_000_300_000,
        cellX: 3,
        cellY: 5,
        cellSizeMeters: 5,
        entityType: 'pedestrian',
        uniqueEntities: 6,
        sampleCount: 17,
        meanSpeedMps: 1.3,
        meanQuality: 0.81,
      },
    ],
  };
}

function batch(overrides: Partial<PreparedCommunityBatch> = {}): PreparedCommunityBatch {
  const payload = envelope();
  return {
    nodeId: payload.nodeId,
    sequence: payload.sequence,
    payloadSha256: 'a'.repeat(64),
    envelope: payload,
    ...overrides,
  };
}

function queryKinds(db: FakeDatabase): string[] {
  return db.queries.map(({ sql }) => {
    if (sql.includes('insert into private.community_batches')) return 'batch_insert';
    if (sql.includes('select batch_id::text, payload_sha256')) return 'batch_select';
    if (sql.includes('insert into private.flow_aggregates')) return 'flow_insert';
    if (sql.includes('insert into private.spatial_aggregates')) return 'spatial_insert';
    if (sql.includes('update private.node_credentials')) return 'credential_touch';
    if (sql.includes('join private.node_credentials')) return 'credential_lookup';
    return 'other';
  });
}

describe('PostgreSQL node credential lookup', () => {
  it('maps an active private credential row and segment without exposing extra database fields', async () => {
    const db = new FakeDatabase((sql, params) => {
      expect(sql).toContain('join private.node_credentials');
      expect(params).toEqual(['node_abc12345']);
      return result([{
        node_id: 'node_abc12345',
        segment_id: 'osm_way_123:segment_4',
        credential_hmac: 'b'.repeat(64),
        key_version: '2',
        node_status: 'active',
        expires_at_ms: '1788238800000',
        revoked_at_ms: null,
      }]);
    });

    const lookup = createPostgresNodeCredentialLookup(db);
    await expect(lookup('node_abc12345')).resolves.toEqual({
      nodeId: 'node_abc12345',
      segmentId: 'osm_way_123:segment_4',
      credentialHmac: 'b'.repeat(64),
      keyVersion: 2,
      nodeStatus: 'active',
      expiresAtMs: 1_788_238_800_000,
    });
    expect(queryKinds(db)).toEqual(['credential_lookup']);
  });

  it('fails closed on malformed status, HMAC, key version or epoch fields', async () => {
    const rows = [
      {
        node_id: 'node_abc12345', segment_id: 'segment', credential_hmac: 'b'.repeat(64),
        key_version: 1, node_status: 'deleted', expires_at_ms: null, revoked_at_ms: null,
      },
      {
        node_id: 'node_abc12345', segment_id: 'segment', credential_hmac: 'not-a-hmac',
        key_version: 1, node_status: 'active', expires_at_ms: null, revoked_at_ms: null,
      },
      {
        node_id: 'node_abc12345', segment_id: 'segment', credential_hmac: 'b'.repeat(64),
        key_version: 0, node_status: 'active', expires_at_ms: null, revoked_at_ms: null,
      },
      {
        node_id: 'node_abc12345', segment_id: 'segment', credential_hmac: 'b'.repeat(64),
        key_version: 1, node_status: 'active', expires_at_ms: 'NaN', revoked_at_ms: null,
      },
    ];

    for (const row of rows) {
      const db = new FakeDatabase(() => result([row]));
      const lookup = createPostgresNodeCredentialLookup(db);
      await expect(lookup('node_abc12345')).resolves.toBeUndefined();
    }
  });

  it('returns undefined when the node has no private credential row', async () => {
    const db = new FakeDatabase(() => result([]));
    await expect(createPostgresNodeCredentialLookup(db)('node_missing')).resolves.toBeUndefined();
  });
});

describe('transactional PostgreSQL Community store', () => {
  it('atomically inserts a new batch, both aggregate families and credential last-used timestamp', async () => {
    const db = new FakeDatabase((sql) => {
      if (sql.includes('insert into private.community_batches')) {
        return result([{ batch_id: '11111111-1111-4111-8111-111111111111', payload_sha256: 'a'.repeat(64) }]);
      }
      return result([]);
    });

    const store = createPostgresCommunityIngestionStore(db);
    await expect(store.persist(batch())).resolves.toEqual({
      status: 'inserted',
      batchId: '11111111-1111-4111-8111-111111111111',
    });

    expect(db.transactionCalls).toBe(1);
    expect(db.committed).toBe(1);
    expect(db.rolledBack).toBe(0);
    expect(queryKinds(db)).toEqual([
      'batch_insert', 'flow_insert', 'spatial_insert', 'credential_touch',
    ]);

    const flowJson = String(db.queries[1]?.params[1]);
    expect(JSON.parse(flowJson)).toEqual([{
      bucket_start_ms: 1_788_000_000_000,
      bucket_end_ms: 1_788_000_300_000,
      entity_type: 'cyclist',
      direction: 'A_TO_B',
      count: 12,
      mean_quality: 0.87,
    }]);

    const spatialJson = String(db.queries[2]?.params[1]);
    expect(JSON.parse(spatialJson)).toEqual([{
      bucket_start_ms: 1_788_000_000_000,
      bucket_end_ms: 1_788_000_300_000,
      cell_x: 3,
      cell_y: 5,
      cell_size_meters: 5,
      entity_type: 'pedestrian',
      unique_entities: 6,
      sample_count: 17,
      mean_speed_mps: 1.3,
      mean_quality: 0.81,
    }]);
  });

  it('treats the same node sequence and hash as a duplicate without inserting aggregates', async () => {
    const db = new FakeDatabase((sql) => {
      if (sql.includes('insert into private.community_batches')) return result([]);
      if (sql.includes('select batch_id::text, payload_sha256')) {
        return result([{ batch_id: '22222222-2222-4222-8222-222222222222', payload_sha256: 'a'.repeat(64) }]);
      }
      return result([]);
    });

    const store = createPostgresCommunityIngestionStore(db);
    await expect(store.persist(batch())).resolves.toEqual({
      status: 'duplicate_same_payload',
      batchId: '22222222-2222-4222-8222-222222222222',
    });
    expect(queryKinds(db)).toEqual(['batch_insert', 'batch_select', 'credential_touch']);
  });

  it('returns a conflict when an existing node sequence has different bytes and does not touch aggregates or credential usage', async () => {
    const db = new FakeDatabase((sql) => {
      if (sql.includes('insert into private.community_batches')) return result([]);
      if (sql.includes('select batch_id::text, payload_sha256')) {
        return result([{ batch_id: '33333333-3333-4333-8333-333333333333', payload_sha256: 'c'.repeat(64) }]);
      }
      return result([]);
    });

    const store = createPostgresCommunityIngestionStore(db);
    await expect(store.persist(batch())).resolves.toEqual({
      status: 'conflict',
      existingPayloadSha256: 'c'.repeat(64),
    });
    expect(queryKinds(db)).toEqual(['batch_insert', 'batch_select']);
  });

  it('throws and rolls back if ON CONFLICT reports no insert but the conflicting row is not visible', async () => {
    const db = new FakeDatabase(() => result([]));
    const store = createPostgresCommunityIngestionStore(db);
    await expect(store.persist(batch())).rejects.toThrow('idempotency invariant violated');
    expect(db.transactionCalls).toBe(1);
    expect(db.committed).toBe(0);
    expect(db.rolledBack).toBe(1);
  });

  it('keeps untrusted payload values in SQL parameters rather than interpolating them into statements', async () => {
    const malicious = `sha256:abc'); drop table private.community_batches; --`;
    const prepared = batch();
    prepared.envelope.modelFingerprint = malicious;
    prepared.envelope.observedSegment.sourceVersion = `2026'; select pg_sleep(10); --`;

    const db = new FakeDatabase((sql) => {
      expect(sql).not.toContain(malicious);
      expect(sql).not.toContain('pg_sleep(10)');
      if (sql.includes('insert into private.community_batches')) {
        return result([{ batch_id: '44444444-4444-4444-8444-444444444444', payload_sha256: prepared.payloadSha256 }]);
      }
      return result([]);
    });

    const store = createPostgresCommunityIngestionStore(db);
    await expect(store.persist(prepared)).resolves.toMatchObject({ status: 'inserted' });
    const batchInsert = db.queries[0];
    expect(batchInsert?.params).toContain(malicious);
    expect(batchInsert?.params).toContain(`2026'; select pg_sleep(10); --`);
  });

  it('rolls back the whole batch if any aggregate insert fails', async () => {
    const db = new FakeDatabase((sql) => {
      if (sql.includes('insert into private.community_batches')) {
        return result([{ batch_id: '55555555-5555-4555-8555-555555555555', payload_sha256: 'a'.repeat(64) }]);
      }
      if (sql.includes('insert into private.flow_aggregates')) {
        throw new Error('simulated constraint failure');
      }
      return result([]);
    });

    const store = createPostgresCommunityIngestionStore(db);
    await expect(store.persist(batch())).rejects.toThrow('simulated constraint failure');
    expect(db.committed).toBe(0);
    expect(db.rolledBack).toBe(1);
    expect(queryKinds(db)).toEqual(['batch_insert', 'flow_insert']);
  });
});
