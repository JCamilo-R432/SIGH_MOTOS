// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  database/DatabaseHealth.ts
//  Monitor de salud de PostgreSQL con auto-reparación
//
//  Chequeos realizados:
//    1. Latencia de consulta básica (SELECT 1)
//    2. Conteo de conexiones activas vs. límite
//    3. Detección de conexiones bloqueadas (pg_stat_activity)
//    4. Tamaño de la base de datos
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

import { DatabaseHealthResult } from '../types';
import { DatabasePool } from './DatabasePool';

interface ExtendedHealthResult extends DatabaseHealthResult {
  activeConnections?: number;
  blockedConnections?: number;
  dbSizeMb?: number;
  recommendation?: string;
}

export class DatabaseHealth {
  private readonly pool: DatabasePool;
  private latencyHistory: number[] = [];

  constructor(pool: DatabasePool) {
    this.pool = pool;
  }

  // ─── Chequeo básico de conectividad ───────────────────────────────────────

  async check(): Promise<DatabaseHealthResult> {
    const start = Date.now();
    try {
      await this.pool.query('SELECT 1 AS health_check');
      const latencyMs = Date.now() - start;
      this.latencyHistory.push(latencyMs);
      if (this.latencyHistory.length > 60) this.latencyHistory.shift();
      return { healthy: true, latencyMs, checkedAt: new Date() };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ─── Diagnóstico completo ─────────────────────────────────────────────────

  async fullDiagnosis(): Promise<ExtendedHealthResult> {
    const base = await this.check();
    if (!base.healthy) return base;

    const extended: ExtendedHealthResult = { ...base };

    try {
      const [connectionsResult, sizeResult, blockedResult] = await Promise.all([
        this.pool.query<{ count: string }>(
          `SELECT count(*) FROM pg_stat_activity WHERE state = 'active'`
        ),
        this.pool.query<{ size: string }>(
          `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`
        ),
        this.pool.query<{ count: string }>(
          `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'`
        ),
      ]);

      extended.activeConnections = parseInt(connectionsResult.rows[0]?.count ?? '0', 10);
      extended.dbSizeMb = parseInt((sizeResult.rows[0]?.size ?? '0').replace(/\D/g, ''), 10);
      extended.blockedConnections = parseInt(blockedResult.rows[0]?.count ?? '0', 10);

      const avgLatency = this.getAvgLatency();
      if (avgLatency > 500) {
        extended.recommendation = `Latencia alta (${avgLatency}ms avg). Revisar índices y queries lentas.`;
      }
      if ((extended.blockedConnections ?? 0) > 5) {
        extended.recommendation = `${extended.blockedConnections} conexiones bloqueadas. Posible deadlock.`;
      }
    } catch (err) {
      this.log('WARN', `Diagnóstico extendido parcialmente fallido: ${err instanceof Error ? err.message : String(err)}`);
    }

    return extended;
  }

  // ─── Auto-reparación ──────────────────────────────────────────────────────

  async autoRepair(): Promise<{ action: string; success: boolean }> {
    const diagnosis = await this.fullDiagnosis();

    if (!diagnosis.healthy) {
      this.log('WARN', 'BD no saludable — sin conexión. Watchdog debe intervenir.');
      return { action: 'none — sin conexión', success: false };
    }

    // Matar conexiones bloqueadas si hay demasiadas
    if ((diagnosis.blockedConnections ?? 0) > 10) {
      try {
        await this.pool.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
           WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()`
        );
        this.log('INFO', `Conexiones bloqueadas terminadas`);
        return { action: 'terminate-blocked-connections', success: true };
      } catch (err) {
        this.log('ERROR', `Fallo al terminar conexiones: ${err instanceof Error ? err.message : String(err)}`);
        return { action: 'terminate-blocked-connections', success: false };
      }
    }

    return { action: 'none-needed', success: true };
  }

  // ─── Observabilidad ────────────────────────────────────────────────────────

  getAvgLatency(): number {
    if (this.latencyHistory.length === 0) return 0;
    return this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
  }

  getLatencyTrend(): 'STABLE' | 'INCREASING' | 'DECREASING' {
    if (this.latencyHistory.length < 10) return 'STABLE';
    const recent = this.latencyHistory.slice(-5);
    const older = this.latencyHistory.slice(-10, -5);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    if (recentAvg > olderAvg * 1.2) return 'INCREASING';
    if (recentAvg < olderAvg * 0.8) return 'DECREASING';
    return 'STABLE';
  }

  private log(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      component: 'DatabaseHealth',
      avgLatencyMs: this.getAvgLatency().toFixed(1),
      message,
    });
    if (level === 'ERROR' || level === 'WARN') process.stderr.write(entry + '\n');
    else process.stdout.write(entry + '\n');
  }
}
