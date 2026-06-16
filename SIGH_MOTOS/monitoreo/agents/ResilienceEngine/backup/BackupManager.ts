// ═══════════════════════════════════════════════════════════════════════════
//  SIGC-Motos — ResilienceEngine
//  backup/BackupManager.ts
//  Gestión automatizada de backups de PostgreSQL con verificación
//
//  Flujo de backup:
//    1. pg_dump dentro del contenedor Docker
//    2. Compresión con gzip
//    3. Verificación de integridad (gunzip -t)
//    4. Cálculo de checksum SHA-256
//    5. Limpieza de backups antiguos
//    6. Registro en historial
//
//  Compatibilidad: Linux/Mac (requiere Docker disponible en PATH)
//  Para Windows: ejecutar desde WSL2 o Git Bash
//
//  Versión: 1.0.0 | Fecha: 2026-06-15
// ═══════════════════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { BackupConfig, BackupResult } from '../types';

const execAsync = promisify(exec);

const DEFAULT_CONFIG: Required<BackupConfig> = {
  backupDir: process.env.BACKUP_DIR ?? '/backups',
  retentionDays: 7,
  containerName: process.env.DB_CONTAINER ?? 'sigc_db',
  dbUser: process.env.DB_USER ?? 'postgres',
  dbName: process.env.DB_NAME ?? 'sigc_motos',
  compress: true,
};

export class BackupManager {
  private readonly config: Required<BackupConfig>;
  private readonly history: BackupResult[] = [];

  constructor(config: Partial<BackupConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Crear backup ──────────────────────────────────────────────────────────

  async createBackup(): Promise<BackupResult> {
    const start = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = this.config.compress ? 'sql.gz' : 'sql';
    const filename = `backup_${this.config.dbName}_${timestamp}.${ext}`;
    const filepath = path.join(this.config.backupDir, filename);

    this.log('INFO', `Iniciando backup → ${filename}`);

    // Asegurar que el directorio existe
    fs.mkdirSync(this.config.backupDir, { recursive: true });

    try {
      await this.dumpDatabase(filepath);
      const verified = await this.verifyBackup(filepath);
      const sizeBytes = fs.statSync(filepath).size;
      const checksum = await this.calculateChecksum(filepath);

      // Guardar checksum junto al backup
      fs.writeFileSync(`${filepath}.sha256`, checksum);

      await this.cleanupOldBackups();

      const result: BackupResult = {
        filepath,
        sizeBytes,
        durationMs: Date.now() - start,
        verified,
        createdAt: new Date(),
      };

      this.history.push(result);
      this.log('INFO',
        `Backup completado: ${filename} ` +
        `(${(sizeBytes / 1024 / 1024).toFixed(2)} MB, ${result.durationMs}ms, ` +
        `verificado: ${verified})`
      );

      return result;
    } catch (err) {
      // Limpiar archivo corrupto si existe
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      this.log('ERROR', `Backup falló: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  // ─── Restaurar backup ─────────────────────────────────────────────────────

  async restoreBackup(filepath: string, targetDb?: string): Promise<void> {
    const db = targetDb ?? this.config.dbName;

    if (!fs.existsSync(filepath)) {
      throw new Error(`Archivo de backup no encontrado: ${filepath}`);
    }

    // Verificar antes de restaurar
    const valid = await this.verifyBackup(filepath);
    if (!valid) {
      throw new Error(`Backup corrupto: ${filepath}`);
    }

    this.log('WARN', `Iniciando restauración de ${filepath} → BD: ${db}`);

    const isCompressed = filepath.endsWith('.gz');
    const cmd = isCompressed
      ? `gunzip -c "${filepath}" | docker exec -i ${this.config.containerName} psql -U ${this.config.dbUser} -d ${db}`
      : `docker exec -i ${this.config.containerName} psql -U ${this.config.dbUser} -d ${db} < "${filepath}"`;

    await execAsync(cmd);
    this.log('INFO', `Restauración completada: ${db}`);
  }

  // ─── Listar backups disponibles ────────────────────────────────────────────

  listBackups(): Array<{ filename: string; sizeBytes: number; createdAt: Date }> {
    if (!fs.existsSync(this.config.backupDir)) return [];
    return fs.readdirSync(this.config.backupDir)
      .filter(f => f.startsWith('backup_') && !f.endsWith('.sha256'))
      .map(f => {
        const fullPath = path.join(this.config.backupDir, f);
        const stat = fs.statSync(fullPath);
        return { filename: f, sizeBytes: stat.size, createdAt: stat.mtime };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // ─── Operaciones internas ─────────────────────────────────────────────────

  private async dumpDatabase(filepath: string): Promise<void> {
    const dumpCmd = `docker exec ${this.config.containerName} pg_dump -U ${this.config.dbUser} --no-acl --no-owner ${this.config.dbName}`;
    const outputCmd = this.config.compress
      ? `${dumpCmd} | gzip > "${filepath}"`
      : `${dumpCmd} > "${filepath}"`;

    await execAsync(outputCmd, { maxBuffer: 512 * 1024 * 1024 });
  }

  private async verifyBackup(filepath: string): Promise<boolean> {
    if (!fs.existsSync(filepath)) return false;
    const stat = fs.statSync(filepath);
    if (stat.size === 0) return false;

    if (filepath.endsWith('.gz')) {
      try {
        await execAsync(`gunzip -t "${filepath}"`);
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }

  private async calculateChecksum(filepath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filepath);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private async cleanupOldBackups(): Promise<void> {
    const cutoffDate = new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000);
    const allBackups = this.listBackups();
    let deleted = 0;

    for (const backup of allBackups) {
      if (backup.createdAt < cutoffDate) {
        const fullPath = path.join(this.config.backupDir, backup.filename);
        const checksumPath = `${fullPath}.sha256`;
        try {
          fs.unlinkSync(fullPath);
          if (fs.existsSync(checksumPath)) fs.unlinkSync(checksumPath);
          deleted++;
        } catch (err) {
          this.log('WARN', `No se pudo eliminar backup antiguo: ${backup.filename}`);
        }
      }
    }

    if (deleted > 0) {
      this.log('INFO', `${deleted} backups antiguos eliminados (retención: ${this.config.retentionDays} días)`);
    }
  }

  // ─── Observabilidad ────────────────────────────────────────────────────────

  getHistory(): BackupResult[] { return [...this.history]; }
  getLastBackup(): BackupResult | null { return this.history[this.history.length - 1] ?? null; }

  private log(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      component: 'BackupManager',
      backupDir: this.config.backupDir,
      dbName: this.config.dbName,
      message,
    });
    if (level === 'ERROR' || level === 'WARN') process.stderr.write(entry + '\n');
    else process.stdout.write(entry + '\n');
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: BackupManager | null = null;
export function getBackupManager(): BackupManager {
  if (!_instance) _instance = new BackupManager();
  return _instance;
}
