// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  logging/SmartLogger.ts
//  Logger estructurado con auto-análisis de patrones de error
//
//  Características:
//    - Logs en formato JSON estructurado (compatible con Loki/Grafana)
//    - Detección automática de patrones de error conocidos
//    - Ejecución de acciones correctivas al detectar patrones
//    - Rotación de logs por tamaño
//    - Contexto de request HTTP (traceId, userId, path)
//    - Niveles: DEBUG < INFO < WARN < ERROR < FATAL
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

import * as fs from 'fs';
import * as path from 'path';
import { LogLevel, LogEntry, ErrorPattern, AutoHealAction } from '../types';

interface SmartLoggerConfig {
  level: LogLevel;
  logDir: string;
  maxFileSizeMb: number;
  maxFiles: number;
  enableConsole: boolean;
  enableFile: boolean;
  enableAutoHeal: boolean;
}

const DEFAULT_CONFIG: SmartLoggerConfig = {
  level: (process.env.LOG_LEVEL as LogLevel) ?? 'INFO',
  logDir: process.env.LOG_DIR ?? '/var/log/sigc',
  maxFileSizeMb: 50,
  maxFiles: 10,
  enableConsole: true,
  enableFile: false,
  enableAutoHeal: true,
};

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4,
};

// ─── Patrones de error con acciones auto-correctivas ──────────────────────────

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: /ECONNREFUSED/,
    action: 'restart-service',
    description: 'Conexión rechazada — servicio dependiente no responde',
  },
  {
    pattern: /too many connections/i,
    action: 'increase-pool',
    description: 'Pool de BD saturado — aumentar maxConnections',
  },
  {
    pattern: /out of memory|heap out of memory/i,
    action: 'clear-cache',
    description: 'Presión de memoria — limpiar cache y forzar GC',
  },
  {
    pattern: /no space left on device|disk.*full/i,
    action: 'cleanup-logs',
    description: 'Disco lleno — eliminar logs y archivos temporales',
  },
  {
    pattern: /ETIMEDOUT|ECONNRESET|socket hang up/i,
    action: 'activate-fallback',
    description: 'Timeout de red — activar fallback local',
  },
  {
    pattern: /deadlock|deadlock detected/i,
    action: 'restart-service',
    description: 'Deadlock en BD — reiniciar transacciones bloqueadas',
  },
];

// ─── Clase principal ──────────────────────────────────────────────────────────

export class SmartLogger {
  private readonly config: SmartLoggerConfig;
  private logStream?: fs.WriteStream;
  private currentFilePath?: string;
  private context: Record<string, unknown> = {};

  private readonly healActionHandlers: Map<AutoHealAction, () => void> = new Map([
    ['restart-service', () => this.handleRestartService()],
    ['increase-pool', () => this.handleIncreasePool()],
    ['clear-cache', () => this.handleClearCache()],
    ['cleanup-logs', () => this.handleCleanupLogs()],
    ['notify-admin', () => this.handleNotifyAdmin()],
    ['activate-fallback', () => this.handleActivateFallback()],
  ]);

  constructor(config: Partial<SmartLoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.enableFile) {
      this.initFileLogging();
    }
  }

  // ─── API pública ───────────────────────────────────────────────────────────

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('DEBUG', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('INFO', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('WARN', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('ERROR', message, meta);
    if (this.config.enableAutoHeal) {
      this.autoAnalyze(message);
    }
  }

  fatal(message: string, meta?: Record<string, unknown>): void {
    this.write('FATAL', message, meta);
    if (this.config.enableAutoHeal) {
      this.autoAnalyze(message);
    }
  }

  /** Establece contexto persistente para todos los logs subsecuentes */
  setContext(ctx: Record<string, unknown>): void {
    this.context = { ...this.context, ...ctx };
  }

  clearContext(): void {
    this.context = {};
  }

  /** Crea un child logger con contexto adicional sin mutar el padre */
  child(childContext: Record<string, unknown>): SmartLogger {
    const child = new SmartLogger(this.config);
    child.setContext({ ...this.context, ...childContext });
    return child;
  }

  // ─── Escritura de log ─────────────────────────────────────────────────────

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.config.level]) return;

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      message,
      ...Object.keys(this.context).length > 0 ? { context: JSON.stringify(this.context) } : {},
      ...(meta ? { meta } : {}),
    };

    const line = JSON.stringify(entry);

    if (this.config.enableConsole) {
      if (LEVEL_WEIGHT[level] >= LEVEL_WEIGHT['WARN']) {
        process.stderr.write(line + '\n');
      } else {
        process.stdout.write(line + '\n');
      }
    }

    if (this.config.enableFile && this.logStream) {
      this.logStream.write(line + '\n');
      this.checkRotation();
    }
  }

  // ─── Auto-análisis de patrones ────────────────────────────────────────────

  private autoAnalyze(message: string): void {
    for (const { pattern, action, description } of ERROR_PATTERNS) {
      if (pattern.test(message)) {
        const healEntry = JSON.stringify({
          ts: new Date().toISOString(),
          level: 'WARN',
          component: 'SmartLogger:AutoHeal',
          patternMatched: pattern.source,
          description,
          action,
          originalMessage: message,
        });
        process.stderr.write(healEntry + '\n');
        this.executeHealAction(action);
        break;
      }
    }
  }

  private executeHealAction(action: AutoHealAction): void {
    const handler = this.healActionHandlers.get(action);
    if (handler) {
      try {
        handler();
      } catch (err) {
        process.stderr.write(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'ERROR',
          component: 'SmartLogger:AutoHeal',
          action,
          error: err instanceof Error ? err.message : String(err),
        }) + '\n');
      }
    }
  }

  // ─── Acciones de auto-reparación ──────────────────────────────────────────

  private handleRestartService(): void {
    process.stderr.write(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'CRITICAL',
      component: 'SmartLogger:AutoHeal',
      action: 'restart-service',
      note: 'Señal de reinicio requerida. En Docker: el health-check debería reiniciar el contenedor.',
    }) + '\n');
  }

  private handleIncreasePool(): void {
    process.stderr.write(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'WARN',
      component: 'SmartLogger:AutoHeal',
      action: 'increase-pool',
      recommendation: 'Aumentar DATABASE_POOL_SIZE en .env y reiniciar el servicio.',
    }) + '\n');
  }

  private handleClearCache(): void {
    if (global.gc) {
      global.gc();
      process.stdout.write(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'INFO',
        component: 'SmartLogger:AutoHeal',
        action: 'clear-cache',
        result: 'GC manual ejecutado',
      }) + '\n');
    }
  }

  private handleCleanupLogs(): void {
    process.stderr.write(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'WARN',
      component: 'SmartLogger:AutoHeal',
      action: 'cleanup-logs',
      note: 'Disco lleno detectado. Ejecutar: find /var/log/sigc -mtime +7 -delete',
    }) + '\n');
  }

  private handleNotifyAdmin(): void {
    process.stderr.write(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'CRITICAL',
      component: 'SmartLogger:AutoHeal',
      action: 'notify-admin',
      note: 'Error crítico detectado. Integrar con webhook de alertas.',
    }) + '\n');
  }

  private handleActivateFallback(): void {
    process.stderr.write(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'WARN',
      component: 'SmartLogger:AutoHeal',
      action: 'activate-fallback',
      note: 'Timeout de red. CircuitBreaker debería activarse automáticamente.',
    }) + '\n');
  }

  // ─── Rotación de archivos de log ───────────────────────────────────────────

  private initFileLogging(): void {
    try {
      fs.mkdirSync(this.config.logDir, { recursive: true });
      this.openNewLogFile();
    } catch (err) {
      process.stderr.write(`SmartLogger: No se pudo inicializar file logging: ${err}\n`);
      this.config.enableFile = false;
    }
  }

  private openNewLogFile(): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.currentFilePath = path.join(this.config.logDir, `app-${timestamp}.log`);
    this.logStream = fs.createWriteStream(this.currentFilePath, { flags: 'a' });
  }

  private checkRotation(): void {
    if (!this.currentFilePath) return;
    try {
      const stat = fs.statSync(this.currentFilePath);
      if (stat.size > this.config.maxFileSizeMb * 1024 * 1024) {
        this.logStream?.end();
        this.openNewLogFile();
        this.cleanOldLogs();
      }
    } catch {
      // Ignorar errores de stat
    }
  }

  private cleanOldLogs(): void {
    try {
      const files = fs.readdirSync(this.config.logDir)
        .filter(f => f.startsWith('app-') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          mtime: fs.statSync(path.join(this.config.logDir, f)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      const toDelete = files.slice(this.config.maxFiles);
      for (const file of toDelete) {
        fs.unlinkSync(path.join(this.config.logDir, file.name));
      }
    } catch {
      // Ignorar errores de limpieza
    }
  }

  close(): void {
    this.logStream?.end();
  }
}

// ─── Singleton global ─────────────────────────────────────────────────────────

export const logger = new SmartLogger({
  level: (process.env.LOG_LEVEL as LogLevel) ?? 'INFO',
  enableConsole: true,
  enableFile: process.env.LOG_TO_FILE === 'true',
  enableAutoHeal: process.env.ENABLE_AUTO_HEAL !== 'false',
});
