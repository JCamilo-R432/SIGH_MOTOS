/**
 * Script de importación masiva de inventario desde Excel.
 * Uso: npx tsx scripts/import-inventory.ts
 * O en Docker: docker compose exec app npx tsx scripts/import-inventory.ts
 *
 * Espera el archivo INFORMACION SOFTWARE.xlsx en la raíz del proyecto.
 * Es idempotente: usa upsert por skuInternal — ejecutar dos veces es seguro.
 */

import 'dotenv/config'
import path from 'path'
import fs from 'fs'
import ExcelJS from 'exceljs'
import { PrismaClient, Prisma } from '@prisma/client'

// ── Config ─────────────────────────────────────────────────────────────────
const EXCEL_FILE   = path.resolve(process.cwd(), 'INFORMACION SOFTWARE.xlsx')
const LOG_DIR      = path.resolve(process.cwd(), 'logs')
const ERROR_LOG    = path.join(LOG_DIR, 'import-errors.log')
const BATCH_SIZE   = 100
const DEFAULT_TAX  = new Prisma.Decimal(19)
const DEFAULT_MARGIN = new Prisma.Decimal(30)

// ── Prisma ──────────────────────────────────────────────────────────────────
const prisma = new PrismaClient({ log: ['error'] })

// ── Logging ─────────────────────────────────────────────────────────────────
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
const logStream = fs.createWriteStream(ERROR_LOG, { flags: 'a' })

const logError = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  logStream.write(line)
  process.stderr.write(`  ❌ ${msg}\n`)
}

// ── Slug helper ──────────────────────────────────────────────────────────────
const toSlug = (str: string): string =>
  str.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

const toCodePrefix = (str: string): string =>
  str.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 6)
    .padEnd(3, 'X')

// ── Category cache ───────────────────────────────────────────────────────────
const categoryCache = new Map<string, string>() // name.lower → id

async function getOrCreateCategory(rawName: string): Promise<string> {
  const normalized = rawName.trim()
  const key = normalized.toLowerCase()
  if (categoryCache.has(key)) return categoryCache.get(key)!

  // Try exact name match first
  let category = await prisma.category.findFirst({
    where: { name: { equals: normalized, mode: 'insensitive' } },
  })

  if (!category) {
    const slug = toSlug(normalized)
    const codePrefix = toCodePrefix(normalized)
    try {
      category = await prisma.category.create({
        data: {
          name: normalized,
          slug: `${slug}-${Date.now()}`,   // unique suffix avoids collision
          codePrefix: codePrefix.slice(0, 6),
          marginPercentage: DEFAULT_MARGIN,
          isActive: true,
        },
      })
    } catch {
      // Race condition — fetch again
      category = await prisma.category.findFirst({
        where: { name: { equals: normalized, mode: 'insensitive' } },
      })
      if (!category) throw new Error(`No se pudo crear categoría: ${normalized}`)
    }
  }

  categoryCache.set(key, category.id)
  return category.id
}

// ── Brand cache ───────────────────────────────────────────────────────────────
const brandCache = new Map<string, string>()

async function getOrCreateBrand(rawName: string): Promise<string> {
  const name = rawName?.trim() || 'Sin Marca'
  const key = name.toLowerCase()
  if (brandCache.has(key)) return brandCache.get(key)!

  let brand = await prisma.brand.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  })
  if (!brand) {
    brand = await prisma.brand.create({
      data: { name, isActive: true },
    })
  }
  brandCache.set(key, brand.id)
  return brand.id
}

// ── Cell helpers ─────────────────────────────────────────────────────────────
const cellStr = (cell: ExcelJS.Cell): string => {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && 'result' in v) return String((v as ExcelJS.CellFormulaValue).result ?? '')
  if (typeof v === 'object' && 'text' in v) return (v as ExcelJS.CellRichTextValue).text
  return String(v).trim()
}

const cellNum = (cell: ExcelJS.Cell, fallback = 0): number => {
  const v = cell.value
  if (v === null || v === undefined) return fallback
  if (typeof v === 'object' && 'result' in v) return Number((v as ExcelJS.CellFormulaValue).result) || fallback
  const n = Number(String(v).replace(/[^0-9.,-]/g, '').replace(',', '.'))
  return isNaN(n) ? fallback : Math.abs(n)
}

const cellBool = (cell: ExcelJS.Cell): boolean => {
  const v = cellStr(cell).toLowerCase()
  if (!v || v === 'false' || v === 'no' || v === '0') return false
  return true
}

// ── Column map ───────────────────────────────────────────────────────────────
// Maps variations of header names → canonical key.
// Adjust these if the real Excel has different headers.
type ColKey =
  | 'sku' | 'barcode' | 'name' | 'costPrice' | 'salePrice'
  | 'taxRate' | 'stock' | 'location' | 'category' | 'brand'
  | 'description' | 'minStock' | 'active' | 'partNumber'

const HEADER_ALIASES: Record<string, ColKey> = {
  // SKU
  'sku interno': 'sku', 'sku': 'sku', 'codigo interno': 'sku',
  'código interno': 'sku', 'ref': 'sku', 'referencia': 'sku', 'codigo producto': 'sku',
  // Barcode
  'codigo barras': 'barcode', 'código barras': 'barcode', 'barcode': 'barcode',
  'ean': 'barcode', 'cod barras': 'barcode', 'codigo de barras': 'barcode',
  // Name
  'nombre comercial': 'name', 'nombre': 'name', 'descripcion': 'name',
  'descripción': 'name', 'producto': 'name', 'articulo': 'name', 'artículo': 'name',
  // Prices
  'precio costo': 'costPrice', 'costo': 'costPrice', 'precio de costo': 'costPrice',
  'costo promedio': 'costPrice', 'valor costo': 'costPrice',
  'precio venta': 'salePrice', 'precio venta base': 'salePrice',
  'precio': 'salePrice', 'valor venta': 'salePrice', 'pvp': 'salePrice',
  // Tax
  'iva': 'taxRate', 'iva %': 'taxRate', 'tasa iva': 'taxRate', 'impuesto': 'taxRate',
  // Stock
  'stock': 'stock', 'stock inicial': 'stock', 'cantidad': 'stock',
  'existencias': 'stock', 'inventario': 'stock', 'cantidad inicial': 'stock',
  // Location
  'ubicacion': 'location', 'ubicación': 'location', 'ubicacion bin': 'location',
  'bin': 'location', 'estante': 'location', 'bodega': 'location',
  // Category
  'categoria': 'category', 'categoría': 'category', 'grupo': 'category',
  'tipo': 'category', 'linea': 'category', 'línea': 'category',
  // Brand
  'marca': 'brand', 'fabricante': 'brand', 'proveedor marca': 'brand',
  // Description
  'descripcion tecnica': 'description', 'descripción técnica': 'description',
  'detalle': 'description', 'observaciones': 'description',
  // Min stock
  'stock minimo': 'minStock', 'stock mínimo': 'minStock', 'minimo': 'minStock',
  'nivel minimo': 'minStock',
  // Active
  'activo': 'active', 'estado': 'active', 'habilitado': 'active',
  // Part number
  'referencia oem': 'partNumber', 'oem': 'partNumber', 'part number': 'partNumber',
  'numero parte': 'partNumber', 'número parte': 'partNumber',
}

const normalizeHeader = (raw: string): ColKey | null => {
  const key = raw.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return HEADER_ALIASES[key] ?? null
}

// ── Main ─────────────────────────────────────────────────────────────────────
interface RowData {
  sku: string
  barcode: string
  name: string
  costPrice: number
  salePrice: number
  taxRate: number
  stock: number
  location: string
  category: string
  brand: string
  description: string
  minStock: number
  active: boolean
  partNumber: string
}

async function main() {
  console.log('\n🏍️  SIGC-Motos — Importación de Inventario\n')
  console.log(`📂  Archivo: ${EXCEL_FILE}`)

  if (!fs.existsSync(EXCEL_FILE)) {
    console.error(`\n❌  No se encontró el archivo: ${EXCEL_FILE}`)
    console.error(`    Copiar al servidor con:\n    scp "INFORMACION SOFTWARE.xlsx" root@<IP>:/opt/SIGH_MOTOS/`)
    process.exit(1)
  }

  // ── Load workbook ──────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(EXCEL_FILE)

  // Use first sheet with data
  const ws = wb.worksheets.find((s) => s.rowCount > 1) ?? wb.worksheets[0]
  console.log(`📊  Hoja activa: "${ws.name}" (${ws.rowCount - 1} filas)\n`)

  // ── Detect header row ──────────────────────────────────────────────────────
  let headerRowNumber = 1
  let colMap: Map<number, ColKey> = new Map()

  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    const row = ws.getRow(r)
    const map = new Map<number, ColKey>()
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = normalizeHeader(cellStr(cell))
      if (key) map.set(col, key)
    })
    if (map.size >= 3) { // at least 3 recognized headers
      colMap = map
      headerRowNumber = r
      break
    }
  }

  if (colMap.size === 0) {
    console.error('❌  No se pudo detectar fila de cabeceras. Verifica que el Excel tenga los encabezados correctos.')
    console.error('    Encabezados esperados: SKU Interno, Nombre Comercial, Precio Costo, Precio Venta Base, Categoría...')
    process.exit(1)
  }

  console.log(`✅  Cabeceras detectadas en fila ${headerRowNumber}:`)
  colMap.forEach((key, col) => process.stdout.write(`   col ${col}→${key} `))
  console.log('\n')

  // ── Collect rows ───────────────────────────────────────────────────────────
  const rows: RowData[] = []
  for (let r = headerRowNumber + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const d: Partial<RowData> = {
      sku: '', barcode: '', name: '', costPrice: 0, salePrice: 0,
      taxRate: 19, stock: 0, location: '', category: '', brand: '',
      description: '', minStock: 5, active: true, partNumber: '',
    }
    colMap.forEach((key, col) => {
      const cell = row.getCell(col)
      switch (key) {
        case 'sku': d.sku = cellStr(cell); break
        case 'barcode': d.barcode = cellStr(cell); break
        case 'name': d.name = cellStr(cell); break
        case 'costPrice': d.costPrice = cellNum(cell); break
        case 'salePrice': d.salePrice = cellNum(cell); break
        case 'taxRate': d.taxRate = cellNum(cell, 19); break
        case 'stock': d.stock = Math.max(0, Math.floor(cellNum(cell))); break
        case 'location': d.location = cellStr(cell); break
        case 'category': d.category = cellStr(cell); break
        case 'brand': d.brand = cellStr(cell); break
        case 'description': d.description = cellStr(cell); break
        case 'minStock': d.minStock = Math.max(0, Math.floor(cellNum(cell, 5))); break
        case 'active': d.active = cellBool(cell); break
        case 'partNumber': d.partNumber = cellStr(cell); break
      }
    })
    if (d.name && d.name.trim().length > 1) rows.push(d as RowData)
  }

  console.log(`📦  Filas válidas encontradas: ${rows.length}\n`)

  // ── Validate & import ──────────────────────────────────────────────────────
  let imported = 0
  let updated = 0
  let errors = 0
  let skipped = 0
  let movementsCreated = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)

    for (const row of batch) {
      const lineNum = i + rows.indexOf(row) + headerRowNumber + 2

      // ── Validations ─────────────────────────────────────────────────────
      if (!row.name || row.name.length < 2) {
        logError(`Fila ${lineNum}: Nombre vacío o muy corto. Saltando.`)
        skipped++
        continue
      }
      if (row.salePrice < 0) {
        logError(`Fila ${lineNum}: Precio venta negativo para "${row.name}". Saltando.`)
        errors++
        continue
      }
      if (row.stock < 0) {
        logError(`Fila ${lineNum}: Stock negativo para "${row.name}". Corrigiendo a 0.`)
        row.stock = 0
      }

      // ── Auto-generate SKU if missing ─────────────────────────────────────
      if (!row.sku) {
        const prefix = (row.category || 'PRD').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3)
        row.sku = `${prefix}-AUTO-${Date.now().toString(36).toUpperCase()}`
      }

      // ── Category lookup/create ─────────────────────────────────────────
      let categoryId: string
      const catName = row.category.trim() || 'Sin Categoría'
      try {
        categoryId = await getOrCreateCategory(catName)
      } catch (err) {
        logError(`Fila ${lineNum}: Error con categoría "${catName}": ${(err as Error).message}`)
        errors++
        continue
      }

      // ── Brand lookup/create (siempre required — crea "Sin Marca" si falta) ──
      let brandId: string
      try {
        brandId = await getOrCreateBrand(row.brand)
      } catch (err) {
        logError(`Fila ${lineNum}: Error con marca "${row.brand}": ${(err as Error).message}. Usando "Sin Marca".`)
        brandId = await getOrCreateBrand('Sin Marca')
      }

      // ── Barcode uniqueness ───────────────────────────────────────────────
      const barcode = row.barcode.trim() || null
      if (barcode) {
        const existing = await prisma.product.findFirst({
          where: { barcodeExternal: barcode, skuInternal: { not: row.sku } },
        })
        if (existing) {
          logError(`Fila ${lineNum}: Código barras "${barcode}" ya existe para otro SKU. Se omitirá el código.`)
        }
      }

      // ── Upsert product ──────────────────────────────────────────────────
      const productData = {
        nameCommercial: row.name.slice(0, 200),
        barcodeExternal: barcode || null,
        partNumberOEM: row.partNumber || 'N/A',
        brandId,
        categoryId,
        descriptionTech: row.description || null,
        compatibleModels: [],
        imageKey: null,
        locationBin: row.location || 'SIN-UBICACION',
        costPriceAvg: new Prisma.Decimal(Math.max(0, row.costPrice)),
        salePriceBase: new Prisma.Decimal(Math.max(0, row.salePrice)),
        taxRate: new Prisma.Decimal(Math.min(100, Math.max(0, row.taxRate))),
        stockQuantity: row.stock,
        minStockLevel: row.minStock,
        isActive: row.active,
      }

      try {
        const result = await prisma.product.upsert({
          where: { skuInternal: row.sku },
          create: { skuInternal: row.sku, ...productData },
          update: productData,
        })

        // Check if it was an insert or update by seeing if createdAt ≈ updatedAt
        const isNew = Math.abs(result.createdAt.getTime() - result.updatedAt.getTime()) < 1000

        if (isNew) {
          imported++
          // Create initial inventory movement for traceability
          if (row.stock > 0) {
            try {
              await prisma.inventoryMovement.create({
                data: {
                  productId: result.id,
                  type: 'ENTRY',
                  quantity: row.stock,
                  unitCostAtMoment: new Prisma.Decimal(Math.max(0, row.costPrice)),
                  referenceDoc: 'IMPORT-INICIAL',
                  reason: 'Stock inicial — importación masiva desde Excel',
                  performedByUserId: null,
                },
              })
              movementsCreated++
            } catch (movErr) {
              logError(`Fila ${lineNum}: No se pudo crear movimiento para "${row.name}": ${(movErr as Error).message}`)
            }
          }
        } else {
          updated++
        }
      } catch (err) {
        const e = err as NodeJS.ErrnoException & { code?: string; meta?: { target?: string[] } }
        if (e.code === 'P2002') {
          // Unique constraint — likely barcode conflict
          const target = e.meta?.target?.join(', ') ?? 'campo único'
          logError(`Fila ${lineNum}: Conflicto de unicidad en [${target}] para "${row.name}" (SKU: ${row.sku}). Saltando.`)
          skipped++
        } else {
          logError(`Fila ${lineNum}: Error al insertar "${row.name}" (SKU: ${row.sku}): ${(err as Error).message}`)
          errors++
        }
        continue
      }
    }

    // Progress
    const done = Math.min(i + BATCH_SIZE, rows.length)
    const pct = Math.round((done / rows.length) * 100)
    process.stdout.write(`\r⏳  Procesando ${done}/${rows.length} (${pct}%)...`)
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(50))
  console.log('📊  RESUMEN DE IMPORTACIÓN')
  console.log('═'.repeat(50))
  console.log(`✅  Productos nuevos:       ${imported}`)
  console.log(`🔄  Productos actualizados: ${updated}`)
  console.log(`⏭️   Saltados (sin nombre):  ${skipped}`)
  console.log(`📦  Movimientos creados:    ${movementsCreated}`)
  console.log(`❌  Errores:                ${errors}`)
  console.log('═'.repeat(50))

  if (errors > 0 || skipped > 0) {
    console.log(`\n⚠️   Ver detalles en: ${ERROR_LOG}`)
  }

  console.log('\n✅  Importación completada.\n')
}

main()
  .catch((err) => {
    console.error('\n💥  Error fatal:', err)
    logError(`Error fatal: ${(err as Error).message}`)
    process.exit(1)
  })
  .finally(async () => {
    logStream.end()
    await prisma.$disconnect()
  })
