// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  bulkhead/Bulkhead.ts
//  Patrón Bulkhead — Aislamiento de recursos y límite de concurrencia
//
//  Inspirado en los compartimentos estancos de un buque: si un servicio
//  externo satura su bulkhead, los demás siguen operando normalmente.
//
//  Características:
//    - Límite de concurrencia configurable
//    - Cola de espera con timeout opcional
//    - Métricas de saturación y rechazo
//    - Registro de instancias por nombre para reutilización
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

import { BulkheadConfig, BulkheadMetrics } from '../types';

interface WaitingItem {
  resolve: (granted: boolean) => void;
  enqueuedAt: number;
}

export class Bulkhead {
  private activeConnections = 0;
  private executionTimes: number[] = [];
  private readonly waitQueue: WaitingItem[] = [];
  private readonly metrics: BulkheadMetrics;
  private readonly config: BulkheadConfig;

  constructor(config: Partial<BulkheadConfig> & { name?: string } = {}) {
    this.config = {
      maxConcurrent: config.maxConcurrent ?? 10,
      maxWaitMs: config.maxWaitMs ?? 5_000,
      name: config.name ?? 'default',
    };
    this.metrics = {
      activeConnections: 0,
      maxConcurrent: this.config.maxConcurrent,
      rejectedRequests: 0,
      completedRequests: 0,
      totalRequests: 0,
      avgExecutionMs: 0,
    };
  }

  // ─── Ejecución con límite de concurrencia ──────────────────────────────────

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.metrics.totalRequests++;
    const granted = await this.acquireSlot();

    if (!granted) {
      this.metrics.rejectedRequests++;
      throw new Error(
        `[Bulkhead:${this.config.name}] Capacidad máxima alcanzada ` +
        `(${this.config.maxConcurrent} conexiones). Request rechazada.`
      );
    }

    const start = Date.now();
    this.activeConnections++;
    this.metrics.activeConnections = this.activeConnections;

    try {
      const result = await fn();
      return result;
    } finally {
      const duration = Date.now() - start;
      this.activeConnections--;
      this.metrics.activeConnections = this.activeConnections;
      this.metrics.completedRequests++;
      this.recordExecutionTime(duration);
      this.releaseSlot();
    }
  }

  // ─── Sistema de cola de espera ─────────────────────────────────────────────

  private acquireSlot(): Promise<boolean> {
    if (this.activeConnections < this.config.maxConcurrent) {
      return Promise.resolve(true);
    }

    if (!this.config.maxWaitMs || this.config.maxWaitMs <= 0) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      const item: WaitingItem = {
        resolve,
        enqueuedAt: Date.now(),
      };
      this.waitQueue.push(item);

      setTimeout(() => {
        const idx = this.waitQueue.indexOf(item);
        if (idx !== -1) {
          this.waitQueue.splice(idx, 1);
          this.log('WARN', `Request expiró en cola después de ${this.config.maxWaitMs}ms`);
          resolve(false);
        }
      }, this.config.maxWaitMs);
    });
  }

  private releaseSlot(): void {
    if (this.waitQueue.length > 0) {
      const waiting = this.waitQueue.shift()!;
      const waitedMs = Date.now() - waiting.enqueuedAt;
      this.log('DEBUG', `Slot liberado — desbloqueando request (esperó ${waitedMs}ms)`);
      waiting.resolve(true);
    }
  }

  // ─── Observabilidad ────────────────────────────────────────────────────────

  getMetrics(): Readonly<BulkheadMetrics> { return { ...this.metrics }; }
  isAtCapacity(): boolean { return this.activeConnections >= this.config.maxConcurrent; }
  getQueueSize(): number { return this.waitQueue.length; }

  private recordExecutionTime(ms: number): void {
    this.executionTimes.push(ms);
    if (this.executionTimes.length > 100) this.executionTimes.shift();
    this.metrics.avgExecutionMs =
      this.executionTimes.reduce((a, b) => a + b, 0) / this.executionTimes.length;
  }

  private log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string): void {
    if (level === 'DEBUG') return;
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      component: `Bulkhead:${this.config.name}`,
      activeConnections: this.activeConnections,
      maxConcurrent: this.config.maxConcurrent,
      queueSize: this.waitQueue.length,
      message,
    });
    if (level === 'ERROR' || level === 'WARN') process.stderr.write(entry + '\n');
    else process.stdout.write(entry + '\n');
  }
}

// ─── Registry de bulkheads por nombre ─────────────────────────────────────────

const registry = new Map<string, Bulkhead>();

export function getBulkhead(name: string, config?: Partial<BulkheadConfig>): Bulkhead {
  if (!registry.has(name)) {
    registry.set(name, new Bulkhead({ ...config, name }));
  }
  return registry.get(name)!;
}

// ─── Instancias predefinidas para SIGC-Motos ──────────────────────────────────

export const databaseBulkhead = getBulkhead('database', { maxConcurrent: 20, maxWaitMs: 3_000 });
export const externalApiBulkhead = getBulkhead('external-api', { maxConcurrent: 5, maxWaitMs: 10_000 });
export const reportsBulkhead = getBulkhead('reports', { maxConcurrent: 3, maxWaitMs: 60_000 });
export const notificationBulkhead = getBulkhead('notifications', { maxConcurrent: 10, maxWaitMs: 5_000 });
