// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  index.ts — Punto de entrada y bootstrap del sistema de resiliencia
//
//  Orden de inicialización:
//    1. GlobalExceptionHandler (primero: captura todo desde el inicio)
//    2. SmartLogger (segundo: logging disponible para el resto)
//    3. DatabasePool + DatabaseHealth
//    4. RedisManager + CacheManager
//    5. Circuit Breakers y Bulkheads
//    6. Watchdog (registra checks de los anteriores)
//    7. AutoScaler
//    8. BackupManager + cron de backups
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

import { installGlobalExceptionHandlers, registerCleanupHandler } from './error-handler/GlobalExceptionHandler';
import { logger } from './logging/SmartLogger';
import { getDatabasePool } from './database/DatabasePool';
import { DatabaseHealth } from './database/DatabaseHealth';
import { getRedisManager } from './cache/RedisManager';
import { CacheManager } from './cache/CacheManager';
import { CircuitBreaker, getCircuitBreaker } from './circuit-breaker/CircuitBreaker';
import { Bulkhead, getBulkhead, databaseBulkhead, externalApiBulkhead, reportsBulkhead, notificationBulkhead } from './bulkhead/Bulkhead';
import { retryWithBackoff, retry, retryOnHttpError } from './retry/RetryStrategy';
import { Watchdog, createSigcWatchdog } from './watchdog/Watchdog';
import { getBackupManager } from './backup/BackupManager';
import { getAutoScaler } from './monitoring/AutoScaler';

// ─── Re-exportaciones ─────────────────────────────────────────────────────────

export {
  // Error handling
  installGlobalExceptionHandlers,
  registerCleanupHandler,

  // Logging
  logger,
  SmartLogger,
} from './logging/SmartLogger';

export {
  AppError,
  ValidationError,
  NotFoundError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  DatabaseError,
  ExternalServiceError,
  RateLimitError,
  globalErrorHandler,
  notFoundHandler,
} from './error-handler/AppError';

export { installGlobalExceptionHandlers, registerCleanupHandler } from './error-handler/GlobalExceptionHandler';

export {
  CircuitBreaker,
  getCircuitBreaker,
  getAllCircuitBreakerMetrics,
} from './circuit-breaker/CircuitBreaker';

export {
  retryWithBackoff,
  retry,
  retryOnHttpError,
} from './retry/RetryStrategy';

export {
  Bulkhead,
  getBulkhead,
  databaseBulkhead,
  externalApiBulkhead,
  reportsBulkhead,
  notificationBulkhead,
} from './bulkhead/Bulkhead';

export { RedisManager, getRedisManager } from './cache/RedisManager';
export { CacheManager } from './cache/CacheManager';
export { getDatabasePool } from './database/DatabasePool';
export { DatabaseHealth } from './database/DatabaseHealth';
export { Watchdog, createSigcWatchdog } from './watchdog/Watchdog';
export { BackupManager, getBackupManager } from './backup/BackupManager';
export { AutoScaler, getAutoScaler } from './monitoring/AutoScaler';
export * from './types';

// ─── Clase de bootstrap principal ─────────────────────────────────────────────

export interface ResilienceEngineConfig {
  enableBackups?: boolean;
  enableAutoScaler?: boolean;
  enableWatchdog?: boolean;
  backupCronSchedule?: string;
  watchdogIntervalMs?: number;
}

export class ResilienceEngine {
  private static initialized = false;
  private static watchdog: Watchdog | null = null;
  private static autoScaler: ReturnType<typeof getAutoScaler> | null = null;
  private static backupInterval: ReturnType<typeof setInterval> | null = null;

  /** Inicializa todos los sistemas de resiliencia en el orden correcto */
  static async initialize(config: ResilienceEngineConfig = {}): Promise<void> {
    if (ResilienceEngine.initialized) {
      logger.warn('ResilienceEngine ya fue inicializado');
      return;
    }

    logger.info('═══ SIGC-Motos ResilienceEngine iniciando ═══');
    const startTime = Date.now();

    // 1. Exception handlers globales
    installGlobalExceptionHandlers();
    logger.info('[1/8] GlobalExceptionHandler instalado');

    // 2. Base de datos
    const dbPool = getDatabasePool();
    const dbHealth = new DatabaseHealth(dbPool);
    dbPool.on('exhausted', () => {
      logger.fatal('Pool de BD exhausto — intervención manual requerida');
    });
    dbPool.on('reconnected', () => {
      logger.info('BD reconectada automáticamente');
    });
    logger.info('[2/8] DatabasePool inicializado');

    // 3. Redis
    const redis = getRedisManager();
    await redis.connect();
    logger.info('[3/8] RedisManager conectado');

    // 4. Cache
    const cache = new CacheManager(redis);
    logger.info('[4/8] CacheManager inicializado');

    // 5. Cleanup handlers para graceful shutdown
    registerCleanupHandler({
      name: 'database-pool',
      fn: () => dbPool.close(),
      timeoutMs: 5_000,
    });
    registerCleanupHandler({
      name: 'redis',
      fn: () => redis.disconnect(),
      timeoutMs: 3_000,
    });
    registerCleanupHandler({
      name: 'logger',
      fn: () => logger.close(),
      timeoutMs: 1_000,
    });
    logger.info('[5/8] Cleanup handlers registrados');

    // 6. Watchdog
    if (config.enableWatchdog !== false) {
      ResilienceEngine.watchdog = createSigcWatchdog({
        checkDb: async () => {
          const result = await dbHealth.check();
          return result.healthy;
        },
        checkRedis: async () => {
          const pong = await redis.ping();
          return pong === 'PONG';
        },
      });
      ResilienceEngine.watchdog.start();
      registerCleanupHandler({
        name: 'watchdog',
        fn: () => ResilienceEngine.watchdog?.stop(),
      });
      logger.info('[6/8] Watchdog iniciado');
    } else {
      logger.info('[6/8] Watchdog deshabilitado por config');
    }

    // 7. AutoScaler
    if (config.enableAutoScaler !== false) {
      ResilienceEngine.autoScaler = getAutoScaler();
      ResilienceEngine.autoScaler.start();
      registerCleanupHandler({
        name: 'auto-scaler',
        fn: () => ResilienceEngine.autoScaler?.stop(),
      });
      logger.info('[7/8] AutoScaler iniciado');
    } else {
      logger.info('[7/8] AutoScaler deshabilitado por config');
    }

    // 8. Backups automáticos
    if (config.enableBackups !== false) {
      const backupManager = getBackupManager();
      const intervalHours = 24;
      ResilienceEngine.backupInterval = setInterval(async () => {
        try {
          await backupManager.createBackup();
        } catch (err) {
          logger.error(`Backup automático falló: ${err instanceof Error ? err.message : String(err)}`);
        }
      }, intervalHours * 60 * 60 * 1000);
      registerCleanupHandler({
        name: 'backup-scheduler',
        fn: () => {
          if (ResilienceEngine.backupInterval) {
            clearInterval(ResilienceEngine.backupInterval);
          }
        },
      });
      logger.info(`[8/8] BackupManager activo — backup cada ${intervalHours}h`);
    } else {
      logger.info('[8/8] Backups automáticos deshabilitados por config');
    }

    ResilienceEngine.initialized = true;
    logger.info(
      `═══ ResilienceEngine listo en ${Date.now() - startTime}ms ═══`,
      {
        watchdog: config.enableWatchdog !== false,
        autoScaler: config.enableAutoScaler !== false,
        backups: config.enableBackups !== false,
      }
    );
  }

  /** Estado global de salud del sistema */
  static getSystemHealth(): Record<string, unknown> {
    return {
      initialized: ResilienceEngine.initialized,
      watchdog: ResilienceEngine.watchdog?.getSystemHealth() ?? null,
      autoScaler: ResilienceEngine.autoScaler?.getCurrentMetrics() ?? null,
      systemSnapshot: ResilienceEngine.autoScaler?.getSystemSnapshot() ?? null,
      timestamp: new Date().toISOString(),
    };
  }
}
