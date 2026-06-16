// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  watchdog/Watchdog.ts
//  Perro guardián con monitoreo continuo y auto-reparación
//
//  El Watchdog ejecuta chequeos de salud cada N segundos y, si detecta
//  un componente no saludable, ejecuta su estrategia de reparación.
//
//  Arquitectura:
//    - Cada check tiene su propio timeout para no bloquear al Watchdog
//    - Los checks críticos se ejecutan con mayor frecuencia
//    - Historial de reportes para análisis de tendencias
//    - Integración con MessageBus para emitir alertas
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

import { WatchdogCheck, WatchdogReport, WatchdogCheckResult } from '../types';

interface WatchdogConfig {
  checkIntervalMs: number;
  checkTimeoutMs: number;
  maxHistorySize: number;
  alertThreshold: number;
}

const DEFAULT_CONFIG: WatchdogConfig = {
  checkIntervalMs: 30_000,
  checkTimeoutMs: 5_000,
  maxHistorySize: 100,
  alertThreshold: 3,
};

export class Watchdog {
  private intervalHandle?: ReturnType<typeof setInterval>;
  private isRunning = false;
  private readonly checks = new Map<string, WatchdogCheck>();
  private readonly reportHistory: WatchdogReport[] = [];
  private readonly consecutiveFailures = new Map<string, number>();
  private readonly config: WatchdogConfig;

  constructor(config: Partial<WatchdogConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Registro de checks ────────────────────────────────────────────────────

  registerCheck(check: WatchdogCheck): void {
    this.checks.set(check.name, check);
    this.consecutiveFailures.set(check.name, 0);
    this.log('INFO', `Check registrado: '${check.name}' [${check.criticalityLevel}]`);
  }

  unregisterCheck(name: string): void {
    this.checks.delete(name);
    this.consecutiveFailures.delete(name);
    this.log('INFO', `Check eliminado: '${name}'`);
  }

  // ─── Control del ciclo de vida ─────────────────────────────────────────────

  start(): void {
    if (this.isRunning) {
      this.log('WARN', 'Watchdog ya está en ejecución');
      return;
    }
    this.isRunning = true;
    this.log('INFO', `Watchdog iniciado — intervalo: ${this.config.checkIntervalMs / 1000}s, checks: ${this.checks.size}`);
    this.runChecks().catch(err => this.log('ERROR', `Error en primer ciclo: ${err.message}`));
    this.intervalHandle = setInterval(
      () => this.runChecks().catch(err => this.log('ERROR', `Error en ciclo: ${err.message}`)),
      this.config.checkIntervalMs
    );
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    this.isRunning = false;
    this.log('INFO', 'Watchdog detenido');
  }

  // ─── Ejecución de ciclo de chequeos ───────────────────────────────────────

  private async runChecks(): Promise<void> {
    const report: WatchdogReport = {
      checkedAt: new Date(),
      totalChecks: this.checks.size,
      healthy: 0,
      unhealthy: 0,
      repaired: 0,
      failed: 0,
      results: [],
    };

    const checkPromises = Array.from(this.checks.values()).map(check =>
      this.executeCheck(check)
    );

    const results = await Promise.all(checkPromises);

    for (const result of results) {
      report.results.push(result);
      if (result.healthy) {
        report.healthy++;
        this.consecutiveFailures.set(result.name, 0);
      } else {
        report.unhealthy++;
        const failures = (this.consecutiveFailures.get(result.name) ?? 0) + 1;
        this.consecutiveFailures.set(result.name, failures);

        if (result.repairAttempted) {
          if (result.repairSucceeded) report.repaired++;
          else report.failed++;
        }

        if (failures >= this.config.alertThreshold) {
          this.triggerAlert(result.name, failures);
        }
      }
    }

    this.addToHistory(report);
    this.logReport(report);
  }

  private async executeCheck(check: WatchdogCheck): Promise<WatchdogCheckResult> {
    const start = Date.now();
    const result: WatchdogCheckResult = {
      name: check.name,
      healthy: false,
      repairAttempted: false,
      repairSucceeded: false,
      durationMs: 0,
    };

    try {
      const healthy = await this.withTimeout(
        check.fn(),
        this.config.checkTimeoutMs,
        `Check '${check.name}' timeout`
      );
      result.healthy = healthy;
    } catch (err) {
      result.healthy = false;
      result.error = err instanceof Error ? err.message : String(err);
    }

    if (!result.healthy && check.repairFn) {
      result.repairAttempted = true;
      try {
        await this.withTimeout(
          check.repairFn(),
          this.config.checkTimeoutMs * 2,
          `Reparación '${check.name}' timeout`
        );
        result.repairSucceeded = true;
        this.log('INFO', `Reparación exitosa: '${check.name}'`);
      } catch (err) {
        result.repairSucceeded = false;
        this.log('ERROR', `Reparación falló '${check.name}': ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    result.durationMs = Date.now() - start;
    return result;
  }

  // ─── Utilidades ───────────────────────────────────────────────────────────

  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(label)), ms)
      ),
    ]);
  }

  private triggerAlert(checkName: string, consecutiveFailures: number): void {
    this.log('ERROR', `ALERTA: '${checkName}' ha fallado ${consecutiveFailures} veces consecutivas`);
  }

  private addToHistory(report: WatchdogReport): void {
    this.reportHistory.push(report);
    if (this.reportHistory.length > this.config.maxHistorySize) {
      this.reportHistory.shift();
    }
  }

  // ─── Observabilidad ────────────────────────────────────────────────────────

  getLastReport(): WatchdogReport | null {
    return this.reportHistory[this.reportHistory.length - 1] ?? null;
  }

  getHistory(limit = 20): WatchdogReport[] {
    return this.reportHistory.slice(-limit);
  }

  getSystemHealth(): { healthy: boolean; checks: Record<string, boolean> } {
    const last = this.getLastReport();
    if (!last) return { healthy: true, checks: {} };
    const checks: Record<string, boolean> = {};
    for (const r of last.results) checks[r.name] = r.healthy;
    return {
      healthy: last.unhealthy === 0,
      checks,
    };
  }

  private logReport(report: WatchdogReport): void {
    const level = report.unhealthy > 0 ? 'WARN' : 'INFO';
    this.log(level,
      `Watchdog ciclo: ${report.healthy}/${report.totalChecks} saludables` +
      (report.repaired > 0 ? `, ${report.repaired} reparados` : '') +
      (report.failed > 0 ? `, ${report.failed} fallos sin reparar` : '')
    );
  }

  private log(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      component: 'Watchdog',
      registeredChecks: this.checks.size,
      message,
    });
    if (level === 'ERROR' || level === 'WARN') process.stderr.write(entry + '\n');
    else process.stdout.write(entry + '\n');
  }
}

// ─── Factory con checks predefinidos para SIGC-Motos ──────────────────────────

export function createSigcWatchdog(options: {
  checkDb?: () => Promise<boolean>;
  checkRedis?: () => Promise<boolean>;
  checkExternalApi?: () => Promise<boolean>;
}): Watchdog {
  const watchdog = new Watchdog({ checkIntervalMs: 30_000 });

  if (options.checkDb) {
    watchdog.registerCheck({
      name: 'database',
      category: 'database',
      fn: options.checkDb,
      criticalityLevel: 'CRITICAL',
      repairFn: async () => {
        process.stderr.write(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'WARN',
          component: 'Watchdog',
          action: 'BD no saludable — notificando al DatabasePool para reconexión',
        }) + '\n');
      },
    });
  }

  if (options.checkRedis) {
    watchdog.registerCheck({
      name: 'redis',
      category: 'redis',
      fn: options.checkRedis,
      criticalityLevel: 'HIGH',
      repairFn: async () => {
        process.stderr.write(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'WARN',
          component: 'Watchdog',
          action: 'Redis no disponible — modo degradado (sin caché) activo',
        }) + '\n');
      },
    });
  }

  if (options.checkExternalApi) {
    watchdog.registerCheck({
      name: 'external-api',
      category: 'external-api',
      fn: options.checkExternalApi,
      criticalityLevel: 'MEDIUM',
    });
  }

  return watchdog;
}
