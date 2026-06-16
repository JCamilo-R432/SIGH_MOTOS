// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  circuit-breaker/CircuitBreaker.ts
//  Patrón Circuit Breaker — Protección ante fallos en cascada
//
//  Estados:
//    CLOSED   → operación normal, fallos se acumulan
//    OPEN     → corto-circuito activo, redirige a fallback
//    HALF_OPEN → prueba si el servicio se recuperó
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

import { CircuitBreakerConfig, CircuitBreakerMetrics, CircuitState } from '../types';

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly metrics: CircuitBreakerMetrics;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeoutMs: config.resetTimeoutMs ?? 30_000,
      name: config.name ?? 'default',
    };
    this.metrics = {
      state: 'CLOSED',
      failureCount: 0,
      successCount: 0,
      totalCalls: 0,
      lastStateChangeAt: new Date(),
      openedCount: 0,
      fallbackUsed: 0,
    };
  }

  // ─── Ejecución protegida ───────────────────────────────────────────────────

  async execute<T>(
    fn: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    this.metrics.totalCalls++;

    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.transitionTo('HALF_OPEN');
      } else if (fallback) {
        this.metrics.fallbackUsed++;
        this.log('WARN', `Circuito OPEN — usando fallback (${Math.round(elapsed / 1000)}s para HALF_OPEN)`);
        return fallback();
      } else {
        throw new Error(
          `[CircuitBreaker:${this.config.name}] Circuito OPEN. ` +
          `Reintenta en ${Math.round((this.config.resetTimeoutMs - elapsed) / 1000)}s`
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error instanceof Error ? error : new Error(String(error)));
      if (fallback) {
        this.metrics.fallbackUsed++;
        this.log('WARN', `Fallo capturado — usando fallback`);
        return fallback();
      }
      throw error;
    }
  }

  // ─── Transiciones de estado ────────────────────────────────────────────────

  private onSuccess(): void {
    this.metrics.successCount++;
    if (this.state === 'HALF_OPEN') {
      this.log('INFO', `Prueba HALF_OPEN exitosa — cerrando circuito`);
      this.transitionTo('CLOSED');
    }
    if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  private onFailure(error: Error): void {
    this.failureCount++;
    this.metrics.failureCount++;
    this.lastFailureTime = Date.now();
    this.metrics.lastFailureAt = new Date();

    this.log('ERROR', `Fallo #${this.failureCount}: ${error.message}`);

    if (this.state === 'HALF_OPEN') {
      this.log('WARN', `Fallo en HALF_OPEN — reabriendo circuito`);
      this.transitionTo('OPEN');
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.log('WARN', `Umbral de fallos alcanzado (${this.failureCount}) — abriendo circuito`);
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(newState: CircuitState): void {
    const prev = this.state;
    this.state = newState;
    this.metrics.state = newState;
    this.metrics.lastStateChangeAt = new Date();

    if (newState === 'OPEN') {
      this.metrics.openedCount++;
      this.failureCount = 0;
    }
    if (newState === 'CLOSED') {
      this.failureCount = 0;
      this.successCount = 0;
    }

    this.log('INFO', `Transición de estado: ${prev} → ${newState}`);
  }

  // ─── Observabilidad ────────────────────────────────────────────────────────

  getState(): CircuitState { return this.state; }
  getMetrics(): Readonly<CircuitBreakerMetrics> { return { ...this.metrics }; }
  isOpen(): boolean { return this.state === 'OPEN'; }

  /** Reseteo manual para testing o intervención operacional */
  forceReset(): void {
    this.transitionTo('CLOSED');
    this.log('INFO', 'Circuito reseteado manualmente');
  }

  private log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string): void {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      component: `CircuitBreaker:${this.config.name}`,
      state: this.state,
      failureCount: this.failureCount,
      message,
    });
    if (level === 'ERROR' || level === 'WARN') process.stderr.write(entry + '\n');
    else process.stdout.write(entry + '\n');
  }
}

// ─── Factory para instancias por servicio ──────────────────────────────────────

const registry = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  if (!registry.has(name)) {
    registry.set(name, new CircuitBreaker({ ...config, name }));
  }
  return registry.get(name)!;
}

export function getAllCircuitBreakerMetrics(): Record<string, CircuitBreakerMetrics> {
  const result: Record<string, CircuitBreakerMetrics> = {};
  for (const [name, cb] of registry) {
    result[name] = cb.getMetrics() as CircuitBreakerMetrics;
  }
  return result;
}
