// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  database/DatabasePool.ts
//  Pool de conexiones PostgreSQL con auto-reconnect y circuit breaker interno
//
//  Estrategia de reconexión:
//    - Backoff exponencial: 1s, 2s, 4s, 8s... hasta maxReconnectAttempts
//    - Después del límite: emite evento 'exhausted' para que el watchdog actúe
//    - Cuando PostgreSQL vuelve: detecta reconexión y resetea contadores
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

import { Pool, PoolClient, QueryResult } from 'pg';
import { EventEmitter } from 'events';
import { DatabasePoolConfig } from '../types';

const DEFAULT_CONFIG: DatabasePoolConfig = {
  connectionString: process.env.DATABASE_URL ?? '',
  maxConnections: 20,
  idleTimeoutMs: 30_000,
  connectionTimeoutMs: 2_000,
  maxReconnectAttempts: 10,
};

interface PoolMetrics {
  totalConnections: number;
  idleConnections: number;
  waitingCount: number;
  reconnectAttempts: number;
  isHealthy: boolean;
  totalQueries: number;
  queryErrors: number;
  avgQueryMs: number;
  lastHealthCheckAt?: Date;
}

export class DatabasePool extends EventEmitter {
  private pool: Pool;
  private reconnectAttempts = 0;
  private isReconnecting = false;
  private queryTimes: number[] = [];
  private readonly config: DatabasePoolConfig;
  private readonly metrics: PoolMetrics;

  constructor(config: Partial<DatabasePoolConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = {
      totalConnections: 0,
      idleConnections: 0,
      waitingCount: 0,
      reconnectAttempts: 0,
      isHealthy: true,
      totalQueries: 0,
      queryErrors: 0,
      avgQueryMs: 0,
    };
    this.pool = this.createPool();
  }

  // ─── Creación y configuración del pool ────────────────────────────────────

  private createPool(): Pool {
    const pool = new Pool({
      connectionString: this.config.connectionString,
      max: this.config.maxConnections,
      idleTimeoutMillis: this.config.idleTimeoutMs,
      connectionTimeoutMillis: this.config.connectionTimeoutMs,
    });

    pool.on('error', (err: Error) => {
      this.log('ERROR', `Error en pool de BD: ${err.message}`);
      this.metrics.isHealthy = false;
      this.scheduleReconnect();
    });

    pool.on('connect', () => {
      this.reconnectAttempts = 0;
      this.metrics.isHealthy = true;
      if (this.isReconnecting) {
        this.isReconnecting = false;
        this.log('INFO', 'Reconexión a PostgreSQL exitosa');
        this.emit('reconnected');
      }
    });

    pool.on('acquire', () => {
      this.metrics.totalConnections++;
    });

    return pool;
  }

  // ─── Reconexión automática ────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.isReconnecting) return;
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.log('ERROR', `Máximo de intentos de reconexión alcanzado (${this.config.maxReconnectAttempts})`);
      this.emit('exhausted');
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    this.metrics.reconnectAttempts = this.reconnectAttempts;

    const delay = 1_000 * Math.pow(2, this.reconnectAttempts - 1);
    this.log('WARN', `Reconectando PostgreSQL en ${delay}ms (intento ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);

    setTimeout(async () => {
      try {
        const client = await this.pool.connect();
        await client.query('SELECT 1');
        client.release();
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.metrics.isHealthy = true;
        this.log('INFO', 'Reconexión exitosa mediante prueba SELECT 1');
        this.emit('reconnected');
      } catch (err) {
        this.log('WARN', `Intento ${this.reconnectAttempts} fallido: ${err instanceof Error ? err.message : String(err)}`);
        this.isReconnecting = false;
        this.scheduleReconnect();
      }
    }, delay);
  }

  // ─── Ejecución de queries ─────────────────────────────────────────────────

  async query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const start = Date.now();
    this.metrics.totalQueries++;
    let client: PoolClient | null = null;

    try {
      client = await this.pool.connect();
      const result = await client.query<T>(text, params);
      const duration = Date.now() - start;
      this.recordQueryTime(duration);
      return result;
    } catch (err) {
      this.metrics.queryErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      this.log('ERROR', `Query falló: ${msg} | SQL: ${text.slice(0, 100)}`);
      throw err;
    } finally {
      if (client) client.release();
    }
  }

  /** Ejecuta una función dentro de una transacción con rollback automático */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Cierre graceful ──────────────────────────────────────────────────────

  async close(): Promise<void> {
    await this.pool.end();
    this.log('INFO', 'Pool de BD cerrado correctamente');
  }

  // ─── Observabilidad ────────────────────────────────────────────────────────

  getMetrics(): Readonly<PoolMetrics> {
    return {
      ...this.metrics,
      totalConnections: this.pool.totalCount,
      idleConnections: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  isHealthy(): boolean { return this.metrics.isHealthy; }

  private recordQueryTime(ms: number): void {
    this.queryTimes.push(ms);
    if (this.queryTimes.length > 200) this.queryTimes.shift();
    this.metrics.avgQueryMs =
      this.queryTimes.reduce((a, b) => a + b, 0) / this.queryTimes.length;
  }

  private log(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      component: 'DatabasePool',
      reconnectAttempts: this.reconnectAttempts,
      message,
    });
    if (level === 'ERROR' || level === 'WARN') process.stderr.write(entry + '\n');
    else process.stdout.write(entry + '\n');
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: DatabasePool | null = null;

export function getDatabasePool(): DatabasePool {
  if (!_instance) {
    _instance = new DatabasePool();
  }
  return _instance;
}
