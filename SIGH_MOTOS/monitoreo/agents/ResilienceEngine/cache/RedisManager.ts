// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  cache/RedisManager.ts
//  Gestor de Redis con auto-reconnect y degradación elegante
//
//  Si Redis no está disponible, los métodos get/setex retornan null/void
//  sin propagar el error, permitiendo que la aplicación continúe operando
//  en modo degradado (sin caché, pero funcional).
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import { createClient, RedisClientType } from 'redis';

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest?: number;
  connectTimeoutMs?: number;
}

interface RedisManagerMetrics {
  isConnected: boolean;
  reconnectAttempts: number;
  totalGets: number;
  totalSets: number;
  totalErrors: number;
  lastErrorAt?: Date;
  lastConnectedAt?: Date;
}

export class RedisManager extends EventEmitter {
  private client: RedisClientType | null = null;
  private isConnected = false;
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 20;
  private readonly config: RedisConfig;
  private readonly metrics: RedisManagerMetrics;

  constructor(config?: Partial<RedisConfig>) {
    super();
    this.config = {
      host: config?.host ?? process.env.REDIS_HOST ?? 'localhost',
      port: config?.port ?? Number(process.env.REDIS_PORT ?? 6379),
      password: config?.password ?? process.env.REDIS_PASSWORD,
      db: config?.db ?? 0,
      maxRetriesPerRequest: config?.maxRetriesPerRequest ?? 3,
      connectTimeoutMs: config?.connectTimeoutMs ?? 5_000,
    };
    this.metrics = {
      isConnected: false,
      reconnectAttempts: 0,
      totalGets: 0,
      totalSets: 0,
      totalErrors: 0,
    };
  }

  // ─── Conexión ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    const url = this.config.password
      ? `redis://:${this.config.password}@${this.config.host}:${this.config.port}/${this.config.db}`
      : `redis://${this.config.host}:${this.config.port}/${this.config.db}`;

    this.client = createClient({
      url,
      socket: {
        connectTimeout: this.config.connectTimeoutMs,
        reconnectStrategy: (retries) => {
          if (retries > this.maxReconnectAttempts) return new Error('Max reconnects excedidos');
          const delay = Math.min(retries * 100, 3_000);
          this.log('WARN', `Redis reconectando... intento ${retries} en ${delay}ms`);
          return delay;
        },
      },
    }) as RedisClientType;

    this.client.on('connect', () => {
      this.isConnected = true;
      this.isReconnecting = false;
      this.reconnectAttempts = 0;
      this.metrics.isConnected = true;
      this.metrics.lastConnectedAt = new Date();
      this.log('INFO', 'Redis conectado');
      this.emit('connected');
    });

    this.client.on('disconnect', () => {
      this.isConnected = false;
      this.metrics.isConnected = false;
      this.log('WARN', 'Redis desconectado — modo degradado activo');
      this.emit('disconnected');
    });

    this.client.on('error', (err: Error) => {
      this.metrics.totalErrors++;
      this.metrics.lastErrorAt = new Date();
      this.log('ERROR', `Redis error: ${err.message}`);
    });

    try {
      await this.client.connect();
    } catch (err) {
      this.log('ERROR', `Fallo inicial de conexión Redis: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this.isConnected = false;
    this.metrics.isConnected = false;
  }

  // ─── Operaciones con degradación elegante ─────────────────────────────────

  async get(key: string): Promise<string | null> {
    this.metrics.totalGets++;
    if (!this.isConnected || !this.client) {
      this.log('WARN', `Redis no disponible — get(${key}) retornando null`);
      return null;
    }
    try {
      return await this.client.get(key);
    } catch (err) {
      this.metrics.totalErrors++;
      this.log('WARN', `Redis get(${key}) falló — retornando null`);
      return null;
    }
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    this.metrics.totalSets++;
    if (!this.isConnected || !this.client) {
      this.log('WARN', `Redis no disponible — setex(${key}) ignorado`);
      return;
    }
    try {
      await this.client.setEx(key, seconds, value);
    } catch (err) {
      this.metrics.totalErrors++;
      this.log('WARN', `Redis setex(${key}) falló — operación omitida`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.isConnected || !this.client) return;
    try {
      await this.client.del(keys);
    } catch (err) {
      this.metrics.totalErrors++;
      this.log('WARN', `Redis del(${keys}) falló`);
    }
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.isConnected || !this.client) return [];
    try {
      return await this.client.keys(pattern);
    } catch (err) {
      this.metrics.totalErrors++;
      return [];
    }
  }

  async ping(): Promise<string> {
    if (!this.isConnected || !this.client) return 'OFFLINE';
    try {
      return await this.client.ping();
    } catch {
      return 'ERROR';
    }
  }

  async flush(): Promise<void> {
    if (!this.isConnected || !this.client) return;
    try {
      await this.client.flushDb();
      this.log('INFO', 'Cache Redis limpiada');
    } catch (err) {
      this.log('ERROR', `Fallo al limpiar Redis: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Observabilidad ────────────────────────────────────────────────────────

  getMetrics(): Readonly<RedisManagerMetrics> { return { ...this.metrics }; }
  isHealthy(): boolean { return this.isConnected; }

  private log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string): void {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      component: 'RedisManager',
      connected: this.isConnected,
      message,
    });
    if (level === 'ERROR' || level === 'WARN') process.stderr.write(entry + '\n');
    else process.stdout.write(entry + '\n');
  }
}

// ─── Singleton compartido ─────────────────────────────────────────────────────

let _instance: RedisManager | null = null;

export function getRedisManager(): RedisManager {
  if (!_instance) {
    _instance = new RedisManager();
  }
  return _instance;
}
