import { prisma } from '../config/prisma';

const CONFIG_ID = 'main';

export interface BusinessConfigData {
  businessName?: string;
  nit?: string;
  address?: string;
  phone?: string;
  email?: string | null;
  logoKey?: string | null;
  taxRate?: number;
  resolutionDian?: string | null;
  footer?: string;
}

export async function getConfig() {
  return prisma.businessConfig.upsert({
    where:  { id: CONFIG_ID },
    update: {},
    create: { id: CONFIG_ID },
  });
}

export async function updateConfig(data: BusinessConfigData) {
  return prisma.businessConfig.upsert({
    where:  { id: CONFIG_ID },
    update: data,
    create: { id: CONFIG_ID, ...data },
  });
}
