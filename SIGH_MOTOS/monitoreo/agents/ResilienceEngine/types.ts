// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  types.ts — Tipos compartidos para toda la capa de resiliencia
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Número de fallos consecutivos para abrir el circuito */
  failureThreshold: number;
  /** Tiempo en ms antes de intentar HALF_OPEN */
  resetTimeoutMs: number;
  /** Nombre descriptivo para logs y métricas */
  name: string;
}

export interface CircuitBreakerMetrics {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  totalCalls: number;
  lastFailureAt?: Date;
  lastStateChangeAt: Date;
  openedCount: number;
  fallbackUsed: number;
}

// ─── Retry ────────────────────────────────────────────────────────────────────

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  /** Multiplicador para backoff exponencial (default 2) */
  backoffMultiplier?: number;
  /** Función opcional para decidir si el error es retriable */
  isRetriable?: (error: Error) => boolean;
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
  totalDurationMs: number;
}

// ─── Bulkhead ─────────────────────────────────────────────────────────────────

export interface BulkheadConfig {
  maxConcurrent: number;
  /** Tiempo máximo en ms que una request espera en cola antes de rechazarse */
  maxWaitMs?: number;
  name: string;
}

export interface BulkheadMetrics {
  activeConnections: number;
  maxConcurrent: number;
  rejectedRequests: number;
  completedRequests: number;
  totalRequests: number;
  avgExecutionMs: number;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

export interface CacheConfig {
  defaultTtlSeconds: number;
  /** Prefijo para namespacing de claves */
  keyPrefix?: string;
  /** Si true, un fallo de Redis no propaga el error (modo degradado) */
  failSilently?: boolean;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRatio: number;
  invalidations: number;
  errors: number;
}

// ─── Database ─────────────────────────────────────────────────────────────────

export interface DatabasePoolConfig {
  connectionString: string;
  maxConnections: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
  maxReconnectAttempts: number;
}

export interface DatabaseHealthResult {
  healthy: boolean;
  latencyMs: number;
  checkedAt: Date;
  error?: string;
}

// ─── Watchdog ─────────────────────────────────────────────────────────────────

export type RepairStrategy = 'database' | 'redis' | 'external-api' | 'custom';

export interface WatchdogCheck {
  name: string;
  category: RepairStrategy;
  fn: () => Promise<boolean>;
  criticalityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  repairFn?: () => Promise<void>;
}

export interface WatchdogReport {
  checkedAt: Date;
  totalChecks: number;
  healthy: number;
  unhealthy: number;
  repaired: number;
  failed: number;
  results: WatchdogCheckResult[];
}

export interface WatchdogCheckResult {
  name: string;
  healthy: boolean;
  repairAttempted: boolean;
  repairSucceeded: boolean;
  durationMs: number;
  error?: string;
}

// ─── Smart Logger ─────────────────────────────────────────────────────────────

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export type AutoHealAction =
  | 'restart-service'
  | 'increase-pool'
  | 'clear-cache'
  | 'cleanup-logs'
  | 'notify-admin'
  | 'activate-fallback';

export interface ErrorPattern {
  pattern: RegExp;
  action: AutoHealAction;
  description: string;
}

export interface LogEntry {
  ts: string;
  level: LogLevel;
  message: string;
  context?: string;
  meta?: Record<string, unknown>;
  autoHealTriggered?: AutoHealAction;
}

// ─── Backup ───────────────────────────────────────────────────────────────────

export interface BackupConfig {
  backupDir: string;
  retentionDays: number;
  /** Nombre del contenedor Docker de PostgreSQL */
  containerName: string;
  dbUser: string;
  dbName: string;
  /** Comprimir backup con gzip (default true) */
  compress?: boolean;
}

export interface BackupResult {
  filepath: string;
  sizeBytes: number;
  durationMs: number;
  verified: boolean;
  createdAt: Date;
}

// ─── AutoScaler ───────────────────────────────────────────────────────────────

export interface ScalerThresholds {
  cpu: { warn: number; critical: number };
  memory: { warn: number; critical: number };
  requestsPerSecond: { warn: number; critical: number };
  errorRate: { warn: number; critical: number };
}

export interface ScalerMetric {
  name: string;
  value: number;
  unit: string;
  recordedAt: Date;
}

export interface ScalerAlert {
  metric: string;
  value: number;
  threshold: number;
  level: 'WARN' | 'CRITICAL';
  action: string;
  triggeredAt: Date;
}
