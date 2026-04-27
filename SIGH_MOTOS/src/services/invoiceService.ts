/**
 * invoiceService.ts — Módulo 3: Facturación y Documentación Comercial
 *
 * Responsabilidades:
 *  - Formatear una venta (Sale) como documento de factura para impresión térmica
 *  - Gestionar la configuración de la empresa (lectura/escritura en JSON)
 *  - Delegar cancelación de facturas a posService.cancelSale
 *
 * NOTA: No existe un modelo Invoice en el esquema — la factura ES la venta.
 * El saleNumber (FAC-{AÑO}-{SEQ}) es el número de factura.
 * La configuración de empresa se almacena en src/config/companyConfig.json
 * dado que no hay modelo SystemConfiguration en la BD.
 */

import fs   from 'fs';
import path from 'path';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import type { CompanyConfigInput } from '../utils/validators';

// ─── Configuración de empresa ─────────────────────────────────────────────────

export interface CompanyConfig {
  name:    string;
  nit:     string;
  address: string;
  phone:   string;
  email?:  string;
  footer?: string;
}

const CONFIG_PATH = path.join(__dirname, '../config/companyConfig.json');

const DEFAULT_CONFIG: CompanyConfig = {
  name:    'CLAVIJOS MOTOS S.A.S.',
  nit:     '900.XXX.XXX-X',
  address: 'CRA 16 6-40 AGUACHICA CESAR',
  phone:   '3117379097',
  footer:  '¡Gracias por su compra! Garantía según política de fábrica.',
};

// Cache en memoria — invalidado en cada escritura
let _configCache: CompanyConfig | null = null;

/**
 * Lee la configuración de empresa desde el archivo JSON.
 * Usa caché en memoria; si el archivo está ausente o corrupto retorna los defaults.
 */
export function getCompanyConfig(): CompanyConfig {
  if (_configCache) return _configCache;

  try {
    const raw    = fs.readFileSync(CONFIG_PATH, 'utf-8');
    _configCache = JSON.parse(raw) as CompanyConfig;
    return _configCache;
  } catch {
    logger.warn('[invoiceService] companyConfig.json no encontrado o corrupto — usando defaults');
    _configCache = { ...DEFAULT_CONFIG };
    return _configCache;
  }
}

/**
 * Actualiza la configuración de empresa (merge sobre la configuración existente).
 * Persiste los cambios en companyConfig.json e invalida el caché.
 *
 * @param data - Campos a actualizar (no es necesario enviar todos).
 *
 * @example
 * updateCompanyConfig({ phone: '3001234567', email: 'ventas@clavijos.com' })
 */
export function updateCompanyConfig(data: Partial<CompanyConfigInput>): CompanyConfig {
  const current = getCompanyConfig();
  const updated: CompanyConfig = { ...current, ...data };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf-8');
  _configCache = updated;

  logger.info('[invoiceService] Company config updated', { fields: Object.keys(data) });
  return updated;
}

// ─── Documento de factura ──────────────────────────────────────────────────────

/**
 * Estructura del documento de factura para ticket de impresora térmica.
 * Diseñada para ser renderizada directamente por el frontend o driver de impresora.
 */
export interface InvoiceDocument {
  header: {
    company:   string;
    nit:       string;
    address:   string;
    phone:     string;
    email?:    string;
    printedAt: string;        // ISO-8601, momento de generación del ticket
  };
  invoice: {
    number:        string;    // FAC-2026-00001
    date:          string;    // ISO-8601, fecha de la venta
    cashierId:     string;    // userId del vendedor
    paymentMethod: string;
    status:        string;
    notes:         string | null;
  };
  customer: {
    id:             string;
    name:           string;
    identification: string | null;
    phone:          string | null;
    address:        string | null;
  } | null;
  items: Array<{
    sku:       string;
    name:      string;
    qty:       number;
    unitPrice: number;
    discount:  number;
    lineTotal: number;
  }>;
  totals: {
    subtotal:    number;
    discount:    number;
    taxableBase: number;
    taxAmount:   number;
    total:       number;
  };
  footer: {
    message: string;
  };
}

/**
 * Genera el documento de factura estructurado para un ticket de impresora térmica
 * a partir de una venta existente.
 *
 * La factura contiene un snapshot completo de la venta: datos de empresa,
 * datos del cliente (si existe), líneas de producto y totales desglosados.
 *
 * @param identifier - ID de la venta (cuid) o número de factura (FAC-… / VTA-…).
 * @returns InvoiceDocument listo para imprimir, o null si la venta no existe.
 *
 * @example
 * const doc = await generateInvoiceDocument('FAC-2026-00042');
 * // → { header: {...}, invoice: {...}, customer: {...}, items: [...], totals: {...}, footer: {...} }
 */
export async function generateInvoiceDocument(
  identifier: string,
): Promise<InvoiceDocument | null> {
  const sale = await prisma.sale.findFirst({
    where: {
      OR: [{ id: identifier }, { saleNumber: identifier }],
    },
    include: {
      customer: {
        select: {
          id:                   true,
          name:                 true,
          identificationNumber: true,
          phone:                true,
          address:              true,
        },
      },
      items: {
        select: {
          productNameSnapshot: true,
          skuSnapshot:         true,
          quantity:            true,
          unitPrice:           true,
          discountPerItem:     true,
          lineTotal:           true,
        },
      },
    },
  });

  if (!sale) return null;

  const config      = getCompanyConfig();
  const subtotal    = Number(sale.subtotal);
  const discount    = Number(sale.discountAmount);
  const taxAmount   = Number(sale.taxAmount);
  const total       = Number(sale.totalAmount);
  const taxableBase = Math.max(0, subtotal - discount);

  return {
    header: {
      company:   config.name,
      nit:       config.nit,
      address:   config.address,
      phone:     config.phone,
      ...(config.email && { email: config.email }),
      printedAt: new Date().toISOString(),
    },
    invoice: {
      number:        sale.saleNumber,
      date:          sale.createdAt.toISOString(),
      cashierId:     sale.userId,
      paymentMethod: sale.paymentMethod,
      status:        sale.status,
      notes:         sale.notes ?? null,
    },
    customer: sale.customer
      ? {
          id:             sale.customer.id,
          name:           sale.customer.name,
          identification: sale.customer.identificationNumber ?? null,
          phone:          sale.customer.phone ?? null,
          address:        sale.customer.address ?? null,
        }
      : null,
    items: sale.items.map((item) => ({
      sku:       item.skuSnapshot,
      name:      item.productNameSnapshot,
      qty:       item.quantity,
      unitPrice: Number(item.unitPrice),
      discount:  Number(item.discountPerItem),
      lineTotal: Number(item.lineTotal),
    })),
    totals: {
      subtotal,
      discount,
      taxableBase,
      taxAmount,
      total,
    },
    footer: {
      message: config.footer ?? '¡Gracias por su compra!',
    },
  };
}

/**
 * Cancela una factura (= venta) en estado COMPLETED.
 *
 * Transacción atómica delegada a posService.cancelSale:
 *  1. Verifica estado COMPLETED.
 *  2. Restaura stock por cada ítem (movimientos RETURN).
 *  3. Actualiza el estado a CANCELLED.
 *
 * @param id     - ID o número de factura a cancelar.
 * @param reason - Motivo obligatorio para auditoría.
 * @param userId - ID del administrador que ejecuta la cancelación.
 *
 * @throws {Error} Si la factura no existe o no está en estado COMPLETED.
 */
export { cancelSale as cancelInvoice } from './posService';
