# Scripts de SIGC-Motos

## 1. Importación de Inventario desde Excel

### Requisito previo
Copiar el archivo Excel al servidor (si no está):
```bash
scp "INFORMACION SOFTWARE.xlsx" root@79.143.181.220:/opt/SIGH_MOTOS/
```

### Columnas esperadas en el Excel
| Columna (acepta variaciones) | Campo BD | Tipo |
|---|---|---|
| SKU Interno / Referencia / Código Interno | skuInternal | String único |
| Código Barras / EAN / Barcode | barcodeExternal | String nullable |
| Nombre Comercial / Nombre / Artículo | nameCommercial | String |
| Precio Costo / Costo / Valor Costo | costPriceAvg | Decimal |
| Precio Venta / Precio Venta Base / PVP | salePriceBase | Decimal |
| IVA / IVA % / Tasa IVA | taxRate | Decimal (default 19) |
| Stock / Stock Inicial / Existencias | stockQuantity | Int (default 0) |
| Ubicación / Ubicación Bin / Bin | locationBin | String |
| Categoría / Grupo / Línea | category | String → Category.name |
| Marca / Fabricante | brand | String → Brand.name |
| Activo / Estado | isActive | Boolean (default true) |

> El script crea automáticamente las categorías y marcas que no existan.  
> Es **idempotente**: si se ejecuta dos veces, hace upsert por SKU, no duplica.

### Ejecutar localmente
```bash
cd /opt/SIGH_MOTOS
npm run ts-node scripts/import-inventory.ts
# o con tsx:
npx tsx scripts/import-inventory.ts
```

### Ejecutar dentro del contenedor Docker
```bash
docker compose exec app npx tsx scripts/import-inventory.ts
```

### Ver errores
```bash
tail -f logs/import-errors.log
```

---

## 2. Backups Automáticos de Base de Datos

### Setup inicial (ejecutar una sola vez como root en el VPS)

```bash
# 1. Dar permisos ejecutables
chmod +x /opt/SIGH_MOTOS/scripts/backup-db.sh
chmod +x /opt/SIGH_MOTOS/scripts/restore-db.sh

# 2. Crear directorio de backups
mkdir -p /opt/SIGH_MOTOS/backups/db

# 3. Probar el backup manualmente
/opt/SIGH_MOTOS/scripts/backup-db.sh

# 4. Ver que se creó el archivo
ls -lh /opt/SIGH_MOTOS/backups/db/

# 5. Configurar cron (pegar las líneas del archivo crontab.example)
crontab -e
```

### Prueba manual
```bash
# Ejecutar backup ahora
/opt/SIGH_MOTOS/scripts/backup-db.sh

# Ver logs
tail -50 /var/log/sigc-backup.log
```

### Restaurar un backup
```bash
# Restauración interactiva (pide confirmación)
/opt/SIGH_MOTOS/scripts/restore-db.sh backups/db/sigc_backup_YYYYMMDD_HHMMSS.sql.gz

# Restauración forzada (sin confirmación — útil en scripts CI/CD)
FORCE=1 /opt/SIGH_MOTOS/scripts/restore-db.sh backups/db/sigc_backup_20260426_020001.sql.gz

# Listar backups disponibles
ls -lh /opt/SIGH_MOTOS/backups/db/
```

### Verificar cron activo
```bash
# Ver crontab actual
crontab -l

# Estado del servicio cron
sudo systemctl status cron

# Ver logs en tiempo real
tail -f /var/log/sigc-backup.log
```

### Retención de backups
- Los backups locales se conservan **7 días** (configurable con `RETENTION_DAYS` en el script).
- Para backups de largo plazo, considerar copiar a S3/Backblaze B2 desde el script.

---

## 3. Estructura del directorio `backups/`
```
backups/
└── db/
    ├── sigc_backup_20260426_020001.sql.gz
    ├── sigc_backup_20260427_020000.sql.gz
    └── ...
```

---

## 4. Comandos útiles adicionales

```bash
# Ver tamaño de la base de datos
docker compose exec sigc_db psql -U sigc_user -d sigc_db \
  -c "SELECT pg_size_pretty(pg_database_size('sigc_db'));"

# Contar productos importados
docker compose exec sigc_db psql -U sigc_user -d sigc_db \
  -c "SELECT COUNT(*) FROM \"Product\";"

# Ver categorías creadas
docker compose exec sigc_db psql -U sigc_user -d sigc_db \
  -c "SELECT name, COUNT(p.id) as productos FROM \"Category\" c LEFT JOIN \"Product\" p ON p.\"categoryId\" = c.id GROUP BY c.name ORDER BY productos DESC;"
```
