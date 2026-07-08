import Database from 'better-sqlite3';
import type { Trace, CapturePolicy } from '@signalglass/core';
import { sanitizeTraceForStorage } from './redaction.js';

export interface StorageConfig {
  databasePath: string;
}

export class TraceStorage {
  private db: Database.Database;

  constructor(config: StorageConfig) {
    this.db = new Database(config.databasePath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        provider TEXT,
        model TEXT,
        agent TEXT,
        task TEXT,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT
      );

      CREATE TABLE IF NOT EXISTS trace_events (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        parent_event_id TEXT,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        content_phase TEXT,
        source_type TEXT,
        tokens INTEGER,
        model TEXT,
        provider TEXT,
        routing_decision TEXT,
        transformation_summary TEXT,
        metadata TEXT,
        payload_ref TEXT,
        FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_trace_events_trace_id ON trace_events(trace_id);
      CREATE INDEX IF NOT EXISTS idx_traces_created_at ON traces(created_at);
      CREATE INDEX IF NOT EXISTS idx_traces_expires_at ON traces(expires_at);
    `);
  }

  saveTrace(trace: Trace): void {
    const sanitized = sanitizeTraceForStorage(trace);

    const insertTrace = this.db.prepare(`
      INSERT INTO traces (
        id, started_at, ended_at, provider, model, agent, task, mode, status, metadata, expires_at
      ) VALUES (
        @id, @startedAt, @endedAt, @provider, @model, @agent, @task, @mode, @status, @metadata, @expiresAt
      )
    `);

    const insertEvent = this.db.prepare(`
      INSERT INTO trace_events (
        id, trace_id, parent_event_id, timestamp, type, content_phase, source_type,
        tokens, model, provider, routing_decision, transformation_summary, metadata, payload_ref
      ) VALUES (
        @id, @traceId, @parentEventId, @timestamp, @type, @contentPhase, @sourceType,
        @tokens, @model, @provider, @routingDecision, @transformationSummary, @metadata, @payloadRef
      )
    `);

    const transaction = this.db.transaction((trace: Trace) => {
      const expiresAt = this.calculateExpiry(trace.capturePolicy);

      insertTrace.run({
        id: sanitized.id,
        startedAt: sanitized.startedAt,
        endedAt: sanitized.endedAt || null,
        provider: sanitized.provider || null,
        model: sanitized.model || null,
        agent: sanitized.agent || null,
        task: sanitized.task || null,
        mode: sanitized.mode,
        status: sanitized.status,
        metadata: sanitized.metadata ? JSON.stringify(sanitized.metadata) : null,
        expiresAt: expiresAt || null,
      });

      for (const event of sanitized.events) {
        insertEvent.run({
          id: event.id,
          traceId: event.traceId,
          parentEventId: event.parentEventId || null,
          timestamp: event.timestamp,
          type: event.type,
          contentPhase: event.contentPhase || null,
          sourceType: event.sourceType || null,
          tokens: event.tokens || null,
          model: event.model || null,
          provider: event.provider || null,
          routingDecision: event.routingDecision || null,
          transformationSummary: event.transformationSummary || null,
          metadata: event.metadata ? JSON.stringify(event.metadata) : null,
          payloadRef: event.payloadRef ? JSON.stringify(event.payloadRef) : null,
        });
      }
    });

    transaction(sanitized);
  }

  getTrace(id: string): Trace | null {
    const trace = this.db.prepare(`
      SELECT * FROM traces WHERE id = ?
    `).get(id) as any;

    if (!trace) {
      return null;
    }

    const events = this.db.prepare(`
      SELECT * FROM trace_events WHERE trace_id = ? ORDER BY timestamp
    `).all(id) as any[];

    return this.reconstructTrace(trace, events);
  }

  listTraces(limit: number = 100, offset: number = 0): Trace[] {
    const traces = this.db.prepare(`
      SELECT * FROM traces ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset) as any[];

    return traces.map(trace => {
      const events = this.db.prepare(`
        SELECT * FROM trace_events WHERE trace_id = ? ORDER BY timestamp
      `).all(trace.id) as any[];

      return this.reconstructTrace(trace, events);
    });
  }

  deleteTrace(id: string): boolean {
    const result = this.db.prepare('DELETE FROM traces WHERE id = ?').run(id);
    return result.changes > 0;
  }

  deleteExpiredTraces(): number {
    const result = this.db.prepare(`
      DELETE FROM traces WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
    `).run();
    return result.changes;
  }

  private calculateExpiry(policy: CapturePolicy): string | null {
    if (!policy.retentionDays || policy.retentionDays <= 0) {
      return null;
    }

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + policy.retentionDays);
    return expiry.toISOString();
  }

  private reconstructTrace(row: any, events: any[]): Trace {
    return {
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at || undefined,
      provider: row.provider || undefined,
      model: row.model || undefined,
      agent: row.agent || undefined,
      task: row.task || undefined,
      mode: row.mode,
      status: row.status,
      capturePolicy: {
        mode: row.mode,
        storeTraceMetadata: true,
        storeTimelineEventMetadata: true,
        storeTokenMetrics: true,
        storeRoutingDecisions: row.mode === 'standard' || row.mode === 'debug',
        storeTransformationSummaries: row.mode === 'standard' || row.mode === 'debug',
        storeShortRedactedExcerpts: row.mode === 'standard' || row.mode === 'debug',
        storeFullRawPayloads: false,
        storeSecrets: false,
        storeApiKeys: false,
        storeFullToolResults: false,
        redaction: {
          maxExcerptLength: 240,
          secretPatterns: [],
          stripHeaders: ['authorization', 'x-api-key'],
        },
      },
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      events: events.map(event => ({
        id: event.id,
        traceId: event.trace_id,
        parentEventId: event.parent_event_id || undefined,
        timestamp: event.timestamp,
        type: event.type,
        contentPhase: event.content_phase || undefined,
        sourceType: event.source_type || undefined,
        tokens: event.tokens || undefined,
        model: event.model || undefined,
        provider: event.provider || undefined,
        routingDecision: event.routing_decision || undefined,
        transformationSummary: event.transformation_summary || undefined,
        metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
        payloadRef: event.payload_ref ? JSON.parse(event.payload_ref) : undefined,
      })),
    };
  }

  close(): void {
    this.db.close();
  }
}
