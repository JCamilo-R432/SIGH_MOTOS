// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  retry/RetryStrategy.ts
//  Patrón Retry con Exponential Backoff + Jitter
//
//  Algoritmo:
//    delay(n) = min(baseDelay × multiplier^(n-1) + jitter, maxDelay)
//
//  El jitter aleatoriza el delay para evitar "thundering herd" cuando
//  múltiples clientes reintentan al mismo tiempo.
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

import { RetryConfig, RetryResult } from '../types';

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  isRetriable: () => true,
};

// ─── Función principal ────────────────────────────────────────────────────────

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  let lastError: Error = new Error('No attempts made');

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      const value = await fn();
      return {
        value,
        attempts: attempt,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isRetriable = cfg.isRetriable(lastError);
      if (!isRetriable) {
        logRetry('WARN', attempt, cfg.maxAttempts, `Error no retriable: ${lastError.message}`);
        throw lastError;
      }

      if (attempt === cfg.maxAttempts) {
        logRetry('ERROR', attempt, cfg.maxAttempts, `Intentos agotados: ${lastError.message}`);
        break;
      }

      const delay = calculateDelay(attempt, cfg.baseDelayMs, cfg.backoffMultiplier, cfg.maxDelayMs);
      logRetry('WARN', attempt, cfg.maxAttempts, `Fallo. Reintentando en ${delay}ms — ${lastError.message}`);
      await sleep(delay);
    }
  }

  throw lastError;
}

// ─── Retry simple sin resultado envuelto ──────────────────────────────────────

export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1_000
): Promise<T> {
  const result = await retryWithBackoff(fn, { maxAttempts, baseDelayMs });
  return result.value;
}

// ─── Retry condicionado a códigos HTTP ────────────────────────────────────────

export async function retryOnHttpError<T>(
  fn: () => Promise<T>,
  retriableCodes: number[] = [429, 500, 502, 503, 504],
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const result = await retryWithBackoff(fn, {
    ...config,
    isRetriable: (error) => {
      const match = error.message.match(/HTTP (\d+)/);
      if (!match) return true;
      return retriableCodes.includes(parseInt(match[1], 10));
    },
  });
  return result.value;
}

// ─── Utilidades internas ──────────────────────────────────────────────────────

function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  multiplier: number,
  maxDelayMs: number
): number {
  const exponentialDelay = baseDelayMs * Math.pow(multiplier, attempt - 1);
  const jitter = Math.random() * baseDelayMs * 0.5;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.round(ms)));
}

function logRetry(
  level: 'WARN' | 'ERROR',
  attempt: number,
  maxAttempts: number,
  message: string
): void {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component: 'RetryStrategy',
    attempt,
    maxAttempts,
    message,
  });
  if (level === 'ERROR') process.stderr.write(entry + '\n');
  else process.stderr.write(entry + '\n');
}
