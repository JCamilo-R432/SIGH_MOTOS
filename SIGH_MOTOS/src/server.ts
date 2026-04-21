import 'dotenv/config';
import app from './app';
import { logger } from './config/logger';
import { prisma } from './config/prisma';

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  await prisma.$connect();
  logger.info('Database connected');

  app.listen(PORT, () => {
    logger.info(`SIGC-Motos API running on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  logger.error('Fatal startup error', { err });
  process.exit(1);
});
