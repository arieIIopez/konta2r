import type {
  CommunityIngestNodeState,
  CommunityIngestPersistenceInput,
  CommunityIngestPersistenceResult,
  CommunityIngestStore,
} from '../../../src/backend/communityIngest.ts';
import type {
  NodeEnrollPersistenceInput,
  NodeEnrollStore,
} from '../../../src/backend/nodeEnroll.ts';
import type { CommunityAggregateRecord } from '../../../src/community/protocol.ts';
import { createEdgeSql } from './postgres.ts';

export type EdgeSql = ReturnType<typeof createEdgeSql>;

function rowRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function dateMillis(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

export function createPostgresNodeEnrollStore(sql: EdgeSql): NodeEnrollStore {
  return {
    async segmentExists(segmentId: string): Promise<boolean> {
      const rows = await sql`
        select exists(
          select 1 from public.segments where segment_id = ${segmentId}
        ) as exists
      `;
      return rowRecord(rows[0])?.exists === true;
    },

    async persistEnrollment(input: NodeEnrollPersistenceInput): Promise<void> {
      await sql.begin(async (tx) => {
        await tx`
          insert into public.nodes (
            node_id, owner_user_id, label, segment_id, status
          ) values (
            ${input.nodeId}, ${input.ownerUserId}::uuid, ${input.label},
            ${input.segmentId}, ${input.status}
          )
        `;
        await tx`
          insert into private.node_credentials (
            node_id, credential_hmac, key_version
          ) values (
            ${input.nodeId}, ${input.credentialHmac}, ${input.keyVersion}
          )
        `;
      });
    },
  };
}

function flowRows(records: readonly CommunityAggregateRecord[], batchId: string) {
  return records.flatMap((record) => record.aggregateType !== 'flow' ? [] : [{
    batch_id: batchId,
    bucket_start: new Date(record.bucketStartMs),
    bucket_end: new Date(record.bucketEndMs),
    entity_type: record.entityType,
    direction: record.direction,
    count: record.count,
    mean_quality: record.meanQuality,
  }]);
}

function spatialRows(records: readonly CommunityAggregateRecord[], batchId: string) {
  return records.flatMap((record) => record.aggregateType !== 'spatial' ? [] : [{
    batch_id: batchId,
    bucket_start: new Date(record.bucketStartMs),
    bucket_end: new Date(record.bucketEndMs),
    cell_x: record.cellX,
    cell_y: record.cellY,
    cell_size_meters: record.cellSizeMeters,
    entity_type: record.entityType,
    unique_entities: record.uniqueEntities,
    sample_count: record.sampleCount,
    mean_speed_mps: record.meanSpeedMps ?? null,
    mean_quality: record.meanQuality,
  }]);
}

export function createPostgresCommunityIngestStore(sql: EdgeSql): CommunityIngestStore {
  return {
    async getNodeState(nodeId: string): Promise<CommunityIngestNodeState | undefined> {
      const rows = await sql`
        select
          n.node_id,
          n.status,
          n.segment_id,
          c.credential_hmac,
          c.key_version,
          c.expires_at,
          c.revoked_at
        from public.nodes n
        join private.node_credentials c on c.node_id = n.node_id
        where n.node_id = ${nodeId}
        limit 1
      `;
      const row = rowRecord(rows[0]);
      if (!row) return undefined;
      if (
        typeof row.node_id !== 'string'
        || typeof row.status !== 'string'
        || typeof row.credential_hmac !== 'string'
        || typeof row.key_version !== 'number'
      ) return undefined;

      const status = row.status;
      if (!['provisioning', 'active', 'paused', 'revoked'].includes(status)) return undefined;
      const segmentId = typeof row.segment_id === 'string' ? row.segment_id : undefined;
      const expiresAtMs = dateMillis(row.expires_at);
      const revokedAtMs = dateMillis(row.revoked_at);

      return {
        nodeId: row.node_id,
        status: status as CommunityIngestNodeState['status'],
        ...(segmentId === undefined ? {} : { segmentId }),
        credentialHmac: row.credential_hmac,
        keyVersion: row.key_version,
        ...(expiresAtMs === undefined ? {} : { credentialExpiresAtMs: expiresAtMs }),
        ...(revokedAtMs === undefined ? {} : { credentialRevokedAtMs: revokedAtMs }),
      };
    },

    async persistCommunityUpload(
      input: CommunityIngestPersistenceInput,
    ): Promise<CommunityIngestPersistenceResult> {
      return await sql.begin(async (tx) => {
        const envelope = input.envelope;
        const inserted = await tx`
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
            runtime_summary,
            received_at
          ) values (
            ${envelope.nodeId},
            ${envelope.sequence},
            ${input.payloadSha256},
            ${new Date(envelope.generatedAtIso)},
            ${envelope.observedSegment.segmentId},
            ${envelope.observedSegment.source},
            ${envelope.observedSegment.sourceVersion ?? null},
            ${envelope.softwareVersion},
            ${envelope.methodologyVersion},
            ${envelope.modelFingerprint},
            ${JSON.stringify(envelope.quality)}::jsonb,
            ${JSON.stringify(envelope.runtime)}::jsonb,
            ${new Date(input.receivedAtIso)}
          )
          on conflict (node_id, sequence) do nothing
          returning batch_id::text as batch_id
        `;

        const insertedRow = rowRecord(inserted[0]);
        if (!insertedRow || typeof insertedRow.batch_id !== 'string') {
          const existing = await tx`
            select batch_id::text as batch_id, payload_sha256
            from private.community_batches
            where node_id = ${envelope.nodeId} and sequence = ${envelope.sequence}
            limit 1
          `;
          const existingRow = rowRecord(existing[0]);
          if (
            !existingRow
            || typeof existingRow.batch_id !== 'string'
            || typeof existingRow.payload_sha256 !== 'string'
          ) {
            throw new Error('Community idempotency conflict could not be resolved');
          }
          if (existingRow.payload_sha256 === input.payloadSha256) {
            await tx`
              update private.node_credentials
              set last_used_at = ${new Date(input.receivedAtIso)}
              where node_id = ${envelope.nodeId}
            `;
            return {
              outcome: 'duplicate' as const,
              batchId: existingRow.batch_id,
              existingPayloadSha256: existingRow.payload_sha256,
            };
          }
          return {
            outcome: 'sequence_conflict' as const,
            batchId: existingRow.batch_id,
            existingPayloadSha256: existingRow.payload_sha256,
          };
        }

        const batchId = insertedRow.batch_id;
        const flows = flowRows(envelope.records, batchId);
        for (const batch of chunks(flows, 500)) {
          if (batch.length === 0) continue;
          await tx`
            insert into private.flow_aggregates ${tx(
              batch,
              'batch_id',
              'bucket_start',
              'bucket_end',
              'entity_type',
              'direction',
              'count',
              'mean_quality',
            )}
          `;
        }

        const spatials = spatialRows(envelope.records, batchId);
        for (const batch of chunks(spatials, 500)) {
          if (batch.length === 0) continue;
          await tx`
            insert into private.spatial_aggregates ${tx(
              batch,
              'batch_id',
              'bucket_start',
              'bucket_end',
              'cell_x',
              'cell_y',
              'cell_size_meters',
              'entity_type',
              'unique_entities',
              'sample_count',
              'mean_speed_mps',
              'mean_quality',
            )}
          `;
        }

        await tx`
          update private.node_credentials
          set last_used_at = ${new Date(input.receivedAtIso)}
          where node_id = ${envelope.nodeId}
        `;

        return { outcome: 'inserted' as const, batchId };
      });
    },
  };
}
