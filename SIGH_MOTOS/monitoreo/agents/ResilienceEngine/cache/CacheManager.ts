// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  cache/CacheManager.ts
//  Patrón Cache-Aside con fallback automático a la fuente de datos
//
//  Flujo:
//    1. Buscar en Redis → hit: retornar. miss: continuar
//    2. Ejecutar fn() para obtener dato de la fuente
//    3. Guardar en Redis con TTL
//    4. Si Redis falla en cualquier paso, retornar dato de la fuente
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

import { CacheConfig, CacheMetrics } from '../types';
import { RedisManager } from './RedisManager';

export class CacheManager {
  private readonly metrics: CacheMetrics;
  private readonly config: Required<CacheConfig>;
  private readonly redis: RedisManager;

  constructor(redis: RedisManager, config: Partial<CacheConfig> = {}) {
    this.redis = redis;
    this.config = {
      defaultTtlSeconds: config.defaultTtlSeconds ?? 300,
      keyPrefix: config.keyPrefix ?? 'sigc:',
      failSilently: config.failSilently ?? true,
    };
    this.metrics = {
      hits: 0,
      misses: 0,
      hitRatio: 0,
      invalidations: 0,
      errors: 0,
    };
  }

  // ─── Cache-Aside principal ─────────────────────────────────────────────────

  async getOrSet<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds?: number
  ): Promise<T> {
    const fullKey = this.buildKey(key);
    const ttl = ttlSeconds ?? this.config.defaultTtlSeconds;

    try {
      const cached = await this.redis.get(fullKey);
      if (cached !== null) {
        this.metrics.hits++;
        this.updateHitRatio();
        this.log('DEBUG', `CACHE HIT: ${fullKey}`);
        return JSON.parse(cached) as T;
      }
    } catch (err) {
      this.metrics.errors++;
      if (!this.config.failSilently) throw err;
    }

    this.metrics.misses++;
    this.updateHitRatio();
    this.log('DEBUG', `CACHE MISS: ${fullKey} — consultando fuente`);

    const data = await fn();

    try {
      await this.redis.setex(fullKey, ttl, JSON.stringify(data));
    } catch (err) {
      this.metrics.errors++;
      if (!this.config.failSilently) throw err;
    }

    return data;
  }

  // ─── Obtener sin setear (solo lectura) ────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    const fullKey = this.buildKey(key);
    try {
      const cached = await this.redis.get(fullKey);
      if (cached !== null) {
        this.metrics.hits++;
        this.updateHitRatio();
        return JSON.parse(cached) as T;
      }
      this.metrics.misses++;
      this.updateHitRatio();
      return null;
    } catch (err) {
      this.metrics.errors++;
      return null;
    }
  }

  // ─── Setear directamente ───────────────────────────────────────────────────

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const fullKey = this.buildKey(key);
    const ttl = ttlSeconds ?? this.config.defaultTtlSeconds;
    try {
      await this.redis.setex(fullKey, ttl, JSON.stringify(value));
    } catch (err) {
      this.metrics.errors++;
      if (!this.config.failSilently) throw err;
    }
  }

  // ─── Invalidación ─────────────────────────────────────────────────────────

  async invalidate(keyOrPattern: string): Promise<number> {
    const fullKey = this.buildKey(keyOrPattern);
    const keys = await this.redis.keys(fullKey);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    this.metrics.invalidations += keys.length;
    this.log('INFO', `Invalidadas ${keys.length} claves con patrón: ${fullKey}`);
    return keys.length;
  }

  /** Invalida todas las claves con un tag/prefijo dado */
  async invalidateByTag(tag: string): Promise<number> {
    return this.invalidate(`${this.config.keyPrefix}${tag}:*`);
  }

  // ─── Claves predefinidas para SIGC-Motos ──────────────────────────────────

  static keys = {
    inventory: (page: number, limit: number) => `inventory:list:${page}:${limit}`,
    product: (id: string) => `inventory:product:${id}`,
    dashboard: () => `dashboard:summary`,
    report: (type: string, date: string) => `reports:${type}:${date}`,
    treasuryBalance: () => `treasury:balance`,
    userPermissions: (userId: string) => `auth:permissions:${userId}`,
  };

  // ─── Observabilidad ────────────────────────────────────────────────────────

  getMetrics(): Readonly<CacheMetrics> { return { ...this.metrics }; }

  private buildKey(key: string): string {
    return key.startsWith(this.config.keyPrefix) ? key : `${this.config.keyPrefix}${key}`;
  }

  private updateHitRatio(): void {
    const total = this.metrics.hits + this.metrics.misses;
    this.metrics.hitRatio = total > 0 ? this.metrics.hits / total : 0;
  }

  private log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string): void {
    if (level === 'DEBUG') return;
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      component: 'CacheManager',
      hitRatio: `${(this.metrics.hitRatio * 100).toFixed(1)}%`,
      message,
    });
    process.stdout.write(entry + '\n');
  }
}
