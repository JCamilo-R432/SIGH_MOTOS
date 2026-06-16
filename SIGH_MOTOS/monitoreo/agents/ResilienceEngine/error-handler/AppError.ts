// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  error-handler/AppError.ts
//  Jerarquía de errores tipados + middleware Express de manejo global
//
//  Errores de dominio conocidos en SIGC-Motos:
//    - ValidationError: datos de entrada inválidos (zod, business rules)
//    - NotFoundError: recurso no existe
//    - AuthenticationError: credenciales inválidas
//    - AuthorizationError: permisos insuficientes
//    - ConflictError: duplicados o estado inconsistente
//    - DatabaseError: fallos de persistencia
//    - ExternalServiceError: APIs externas no responden
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';

// ─── Clase base ────────────────────────────────────────────────────────────────

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, unknown>;

  constructor(
    statusCode: number,
    message: string,
    code: string,
    isOperational = true,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── Errores específicos de dominio ───────────────────────────────────────────

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(400, message, 'VALIDATION_ERROR', true, context);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string | number) {
    super(
      404,
      id ? `${resource} con id '${id}' no encontrado` : `${resource} no encontrado`,
      'NOT_FOUND'
    );
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Credenciales inválidas o token expirado') {
    super(401, message, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'No tienes permisos para realizar esta acción') {
    super(403, message, 'AUTHORIZATION_ERROR');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(409, message, 'CONFLICT_ERROR', true, context);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, originalError?: Error) {
    super(500, message, 'DATABASE_ERROR', false, {
      originalMessage: originalError?.message,
    });
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, statusCode = 502) {
    super(statusCode, `Error en servicio externo '${service}': ${message}`, 'EXTERNAL_SERVICE_ERROR');
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds?: number) {
    super(429, 'Demasiadas solicitudes. Intenta más tarde.', 'RATE_LIMIT_ERROR', true, {
      retryAfterSeconds,
    });
  }
}

// ─── Middleware de manejo global para Express ─────────────────────────────────

export function globalErrorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL_ERROR';
  const message = isAppError ? err.message : 'Error interno del servidor';

  // Log estructurado
  const logEntry = JSON.stringify({
    ts: new Date().toISOString(),
    level: statusCode >= 500 ? 'ERROR' : 'WARN',
    component: 'GlobalErrorHandler',
    method: req.method,
    path: req.url,
    statusCode,
    code,
    message: err.message,
    stack: statusCode >= 500 ? err.stack : undefined,
    context: isAppError ? err.context : undefined,
    userId: (req as Request & { user?: { id: string } }).user?.id,
  });

  if (statusCode >= 500) {
    process.stderr.write(logEntry + '\n');
    triggerAutoRepair(err.message);
  } else {
    process.stdout.write(logEntry + '\n');
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      timestamp: new Date().toISOString(),
      path: req.url,
      ...(isAppError && err.context ? { details: err.context } : {}),
    },
  });
}

// ─── Auto-reparación basada en tipo de error ──────────────────────────────────

function triggerAutoRepair(errorMessage: string): void {
  const repairs: Array<{ pattern: RegExp; action: string; fn: () => void }> = [
    {
      pattern: /ECONNREFUSED/,
      action: 'notify-connection-refused',
      fn: () => process.stderr.write(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'CRITICAL',
        component: 'AutoRepair',
        action: 'ECONNREFUSED detectado — verificar servicios dependientes',
      }) + '\n'),
    },
    {
      pattern: /too many connections/i,
      action: 'pool-overload',
      fn: () => process.stderr.write(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'CRITICAL',
        component: 'AutoRepair',
        action: 'Pool saturado — considerar aumento de maxConnections o activar bulkhead',
      }) + '\n'),
    },
    {
      pattern: /out of memory/i,
      action: 'memory-pressure',
      fn: () => process.stderr.write(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'CRITICAL',
        component: 'AutoRepair',
        action: 'Presión de memoria — forzar GC y limpiar cache',
      }) + '\n'),
    },
  ];

  for (const { pattern, fn } of repairs) {
    if (pattern.test(errorMessage)) {
      fn();
      break;
    }
  }
}

// ─── Handler para rutas no encontradas ────────────────────────────────────────

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Ruta '${req.method} ${req.url}'`));
}
