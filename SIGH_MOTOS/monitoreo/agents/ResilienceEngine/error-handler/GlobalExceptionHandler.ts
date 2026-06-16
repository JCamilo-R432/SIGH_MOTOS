// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  error-handler/GlobalExceptionHandler.ts
//  Captura de errores no manejados a nivel de proceso Node.js
//
//  Registra 4 señales críticas:
//    - unhandledRejection: Promise rechazada sin catch
//    - uncaughtException: error síncrono sin try/catch
//    - SIGTERM: señal de apagado del SO/Docker
//    - SIGINT: Ctrl+C
//
//  En producción, uncaughtException hace exit(1) después de limpiar.
//  Los demás permiten graceful shutdown.
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

interface CleanupHandler {
  name: string;
  fn: () => Promise<void> | void;
  timeoutMs?: number;
}

// ─── Registro de handlers de limpieza ─────────────────────────────────────────

const cleanupHandlers: CleanupHandler[] = [];

export function registerCleanupHandler(handler: CleanupHandler): void {
  cleanupHandlers.push(handler);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function performGracefulShutdown(reason: string, exitCode: number): Promise<void> {
  log('WARN', `Iniciando graceful shutdown — Razón: ${reason}`);

  const timeout = setTimeout(() => {
    log('ERROR', 'Graceful shutdown tardó demasiado — forzando salida');
    process.exit(exitCode);
  }, 15_000);

  for (const handler of cleanupHandlers) {
    try {
      const handlerTimeout = handler.timeoutMs ?? 5_000;
      await Promise.race([
        Promise.resolve(handler.fn()),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout en handler '${handler.name}'`)), handlerTimeout)
        ),
      ]);
      log('INFO', `Handler '${handler.name}' completado`);
    } catch (err) {
      log('ERROR', `Handler '${handler.name}' falló: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  clearTimeout(timeout);
  log('INFO', `Shutdown completo. Saliendo con código ${exitCode}`);
  process.exit(exitCode);
}

// ─── Instalación de handlers globales ────────────────────────────────────────

export function installGlobalExceptionHandlers(): void {
  // Promise rechazada sin .catch()
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;

    log('ERROR', `unhandledRejection — ${message}`, { stack, promise: String(promise) });

    // En desarrollo: loguear y continuar. En producción: shutdown controlado.
    if (process.env.NODE_ENV === 'production') {
      performGracefulShutdown('unhandledRejection', 1).catch(() => process.exit(1));
    }
  });

  // Error síncrono no capturado — siempre es fatal
  process.on('uncaughtException', (error: Error) => {
    log('FATAL', `uncaughtException — ${error.message}`, { stack: error.stack });
    performGracefulShutdown('uncaughtException', 1).catch(() => process.exit(1));
  });

  // Docker/Kubernetes envían SIGTERM antes de matar el contenedor
  process.on('SIGTERM', () => {
    log('INFO', 'SIGTERM recibido — iniciando graceful shutdown');
    performGracefulShutdown('SIGTERM', 0).catch(() => process.exit(0));
  });

  // Ctrl+C en desarrollo
  process.on('SIGINT', () => {
    log('INFO', 'SIGINT recibido — iniciando graceful shutdown');
    performGracefulShutdown('SIGINT', 0).catch(() => process.exit(0));
  });

  // Señal de recargar configuración (Linux/Mac)
  process.on('SIGHUP', () => {
    log('INFO', 'SIGHUP recibido — recargando configuración');
    // Aquí se podría reimportar configuración sin reiniciar
  });

  log('INFO', 'GlobalExceptionHandler instalado — 5 señales registradas (unhandledRejection, uncaughtException, SIGTERM, SIGINT, SIGHUP)');
}

// ─── Logger interno ────────────────────────────────────────────────────────────

function log(
  level: 'INFO' | 'WARN' | 'ERROR' | 'FATAL',
  message: string,
  extra?: Record<string, unknown>
): void {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component: 'GlobalExceptionHandler',
    pid: process.pid,
    uptime: process.uptime().toFixed(1) + 's',
    message,
    ...extra,
  });
  if (level === 'ERROR' || level === 'FATAL' || level === 'WARN') {
    process.stderr.write(entry + '\n');
  } else {
    process.stdout.write(entry + '\n');
  }
}
