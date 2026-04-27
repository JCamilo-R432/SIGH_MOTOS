import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import * as configService from '../services/configService';
import { logAction } from '../services/auditService';
import { logger } from '../config/logger';

const ok   = (res: Response, data: unknown) => res.status(200).json({ success: true, data });
const fail = (res: Response, error: string, status = 400) =>
  res.status(status).json({ success: false, error });

const updateConfigSchema = z.object({
  businessName:   z.string().min(2).max(200).optional(),
  nit:            z.string().max(30).optional(),
  address:        z.string().max(300).optional(),
  phone:          z.string().max(30).optional(),
  email:          z.string().email().max(200).nullable().optional(),
  logoKey:        z.string().max(500).nullable().optional(),
  taxRate:        z.number().min(0).max(50).optional(),
  resolutionDian: z.string().max(100).nullable().optional(),
  footer:         z.string().max(500).optional(),
});

export async function getConfig(_req: Request, res: Response) {
  try {
    const config = await configService.getConfig();
    return ok(res, config);
  } catch (err) {
    logger.error('[configController] getConfig', { err });
    return fail(res, 'Error al obtener la configuración', 500);
  }
}

export async function updateConfig(req: Request, res: Response) {
  try {
    const data = updateConfigSchema.parse(req.body);
    const config = await configService.updateConfig(data);
    void logAction(req.user?.id ?? null, 'UPDATE_CONFIG', 'BusinessConfig', 'main', data, req.ip);
    return ok(res, config);
  } catch (err) {
    if (err instanceof ZodError) {
      return fail(res, 'Datos inválidos: ' + err.issues.map((e) => e.message).join(', '), 422);
    }
    logger.error('[configController] updateConfig', { err });
    return fail(res, 'Error al guardar la configuración', 500);
  }
}
