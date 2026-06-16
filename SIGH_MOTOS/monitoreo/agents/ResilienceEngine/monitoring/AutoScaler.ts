// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  monitoring/AutoScaler.ts
//  Monitor de métricas del sistema con alertas automáticas
//
//  Métricas rastreadas:
//    - CPU: porcentaje de uso (lectura de /proc/stat en Linux)
//    - Memoria: heap Node.js + memoria del SO
//    - Requests/segundo: throughput de la API
//    - Tasa de errores: porcentaje de respuestas 4xx/5xx
//    - Latencia P95/P99: percentiles de tiempo de respuesta
//
//  Cuando se supera un umbral:
//    - WARN: log de advertencia + evento interno
//    - CRITICAL: acción correctiva automática + alerta externa
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

import * as os from 'os';
import { ScalerAlert, ScalerMetric, ScalerThresholds } from '../types';

interface AutoScalerConfig {
  checkIntervalMs: number;
  windowSizeSeconds: number;
  thresholds: ScalerThresholds;
  onAlert?: (alert: ScalerAlert) => void;
}

const DEFAULT_THRESHOLDS: ScalerThresholds = {
  cpu: { warn: 70, critical: 85 },
  memory: { warn: 75, critical: 90 },
  requestsPerSecond: { warn: 500, critical: 1000 },
  errorRate: { warn: 5, critical: 15 },
};

interface RequestSample {
  timestamp: number;
  isError: boolean;
  durationMs: number;
}

export class AutoScaler {
  private intervalHandle?: ReturnType<typeof setInterval>;
  private isRunning = false;
  private readonly metrics = new Map<string, number>();
  private readonly metricHistory: ScalerMetric[] = [];
  private readonly alerts: ScalerAlert[] = [];
  private readonly requestSamples: RequestSample[] = [];
  private readonly config: AutoScalerConfig;
  private prevCpuInfo: os.CpuInfo[] | null = null;

  constructor(config: Partial<AutoScalerConfig> = {}) {
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 10_000,
      windowSizeSeconds: config.windowSizeSeconds ?? 60,
      thresholds: { ...DEFAULT_THRESHOLDS, ...config.thresholds },
      onAlert: config.onAlert,
    };
  }

  // ─── Control de ciclo de vida ─────────────────────────────────────────────

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.prevCpuInfo = os.cpus();
    this.log('INFO', `AutoScaler iniciado — intervalo: ${this.config.checkIntervalMs / 1000}s`);
    this.collectMetrics();
    this.intervalHandle = setInterval(() => this.collectMetrics(), this.config.checkIntervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    this.isRunning = false;
    this.log('INFO', 'AutoScaler detenido');
  }

  // ─── Registro de requests (llamar desde middleware HTTP) ───────────────────

  recordRequest(durationMs: number, isError: boolean): void {
    this.requestSamples.push({
      timestamp: Date.now(),
      isError,
      durationMs,
    });
    // Mantener ventana de tiempo
    const cutoff = Date.now() - this.config.windowSizeSeconds * 1000;
    while (this.requestSamples.length > 0 && this.requestSamples[0].timestamp < cutoff) {
      this.requestSamples.shift();
    }
  }

  // ─── Actualización manual de métricas ────────────────────────────────────

  updateMetric(name: string, value: number): void {
    this.metrics.set(name, value);
    this.checkCustomThreshold(name, value);
  }

  // ─── Recolección automática de métricas ──────────────────────────────────

  private collectMetrics(): void {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    const heapPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    const systemMemPercent = ((totalMem - freeMem) / totalMem) * 100;
    const cpuPercent = this.calculateCpuPercent();
    const { rps, errorRate, p95, p99 } = this.calculateRequestStats();

    this.recordMetric('cpu', cpuPercent, '%');
    this.recordMetric('memory_heap', heapPercent, '%');
    this.recordMetric('memory_system', systemMemPercent, '%');
    this.recordMetric('requests_per_second', rps, 'req/s');
    this.recordMetric('error_rate', errorRate, '%');
    this.recordMetric('latency_p95', p95, 'ms');
    this.recordMetric('latency_p99', p99, 'ms');
    this.recordMetric('heap_used_mb', memUsage.heapUsed / 1024 / 1024, 'MB');

    this.checkThresholds(cpuPercent, Math.max(heapPercent, systemMemPercent), rps, errorRate);
  }

  // ─── Cálculo de CPU ────────────────────────────────────────────────────────

  private calculateCpuPercent(): number {
    const current = os.cpus();
    if (!this.prevCpuInfo) {
      this.prevCpuInfo = current;
      return os.loadavg()[0] * 10;
    }

    let totalIdle = 0, totalTick = 0;

    for (let i = 0; i < current.length; i++) {
      const prev = this.prevCpuInfo[i];
      const curr = current[i];
      const prevTotal = Object.values(prev.times).reduce((a, b) => a + b, 0);
      const currTotal = Object.values(curr.times).reduce((a, b) => a + b, 0);
      const prevIdle = prev.times.idle;
      const currIdle = curr.times.idle;
      totalIdle += currIdle - prevIdle;
      totalTick += currTotal - prevTotal;
    }

    this.prevCpuInfo = current;
    return totalTick === 0 ? 0 : 100 - (totalIdle / totalTick) * 100;
  }

  // ─── Estadísticas de requests ─────────────────────────────────────────────

  private calculateRequestStats(): { rps: number; errorRate: number; p95: number; p99: number } {
    const windowMs = this.config.windowSizeSeconds * 1000;
    const cutoff = Date.now() - windowMs;
    const recent = this.requestSamples.filter(s => s.timestamp >= cutoff);

    if (recent.length === 0) return { rps: 0, errorRate: 0, p95: 0, p99: 0 };

    const rps = recent.length / this.config.windowSizeSeconds;
    const errors = recent.filter(s => s.isError).length;
    const errorRate = (errors / recent.length) * 100;

    const sorted = [...recent.map(s => s.durationMs)].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;

    return { rps, errorRate, p95, p99 };
  }

  // ─── Evaluación de umbrales ───────────────────────────────────────────────

  private checkThresholds(cpu: number, memory: number, rps: number, errorRate: number): void {
    const checks: Array<{ metric: string; value: number; thresholds: { warn: number; critical: number }; action: string }> = [
      { metric: 'cpu', value: cpu, thresholds: this.config.thresholds.cpu, action: 'Reducir carga o escalar horizontalmente' },
      { metric: 'memory', value: memory, thresholds: this.config.thresholds.memory, action: 'Limpiar cache o aumentar memoria del contenedor' },
      { metric: 'requests_per_second', value: rps, thresholds: this.config.thresholds.requestsPerSecond, action: 'Activar rate limiting y escalar instancias' },
      { metric: 'error_rate', value: errorRate, thresholds: this.config.thresholds.errorRate, action: 'Revisar logs de error y considerar rollback' },
    ];

    for (const { metric, value, thresholds, action } of checks) {
      if (value >= thresholds.critical) {
        this.triggerAlert(metric, value, thresholds.critical, 'CRITICAL', action);
      } else if (value >= thresholds.warn) {
        this.triggerAlert(metric, value, thresholds.warn, 'WARN', action);
      }
    }
  }

  private checkCustomThreshold(name: string, value: number): void {
    this.log('DEBUG', `Métrica personalizada: ${name} = ${value}`);
  }

  private triggerAlert(
    metric: string,
    value: number,
    threshold: number,
    level: 'WARN' | 'CRITICAL',
    action: string
  ): void {
    const alert: ScalerAlert = {
      metric,
      value: Math.round(value * 100) / 100,
      threshold,
      level,
      action,
      triggeredAt: new Date(),
    };

    this.alerts.push(alert);
    if (this.alerts.length > 500) this.alerts.shift();

    this.log(level === 'CRITICAL' ? 'ERROR' : 'WARN',
      `[${level}] ${metric} = ${value.toFixed(1)} (umbral: ${threshold}) — ${action}`
    );

    if (this.config.onAlert) {
      this.config.onAlert(alert);
    }
  }

  // ─── Observabilidad ────────────────────────────────────────────────────────

  getCurrentMetrics(): Record<string, number> {
    return Object.fromEntries(this.metrics);
  }

  getAlerts(since?: Date): ScalerAlert[] {
    if (!since) return [...this.alerts];
    return this.alerts.filter(a => a.triggeredAt >= since);
  }

  getSystemSnapshot(): Record<string, unknown> {
    const memUsage = process.memoryUsage();
    return {
      uptime: process.uptime(),
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      heapUsedMb: (memUsage.heapUsed / 1024 / 1024).toFixed(2),
      heapTotalMb: (memUsage.heapTotal / 1024 / 1024).toFixed(2),
      rssMb: (memUsage.rss / 1024 / 1024).toFixed(2),
      loadAvg: os.loadavg(),
      cpuCount: os.cpus().length,
      totalMemGb: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2),
      freeMemGb: (os.freemem() / 1024 / 1024 / 1024).toFixed(2),
    };
  }

  private recordMetric(name: string, value: number, unit: string): void {
    this.metrics.set(name, value);
    this.metricHistory.push({ name, value, unit, recordedAt: new Date() });
    if (this.metricHistory.length > 10_000) this.metricHistory.shift();
  }

  private log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string): void {
    if (level === 'DEBUG') return;
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      component: 'AutoScaler',
      message,
    });
    if (level === 'ERROR' || level === 'WARN') process.stderr.write(entry + '\n');
    else process.stdout.write(entry + '\n');
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: AutoScaler | null = null;
export function getAutoScaler(config?: Partial<AutoScalerConfig>): AutoScaler {
  if (!_instance) _instance = new AutoScaler(config);
  return _instance;
}
