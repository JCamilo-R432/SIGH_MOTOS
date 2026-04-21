import express from 'express';
import { logger } from './config/logger';
import apiRoutes from './routes/index';

const app = express();

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'SIGC-Motos API' }));

// Rutas del API
app.use('/api/v1', apiRoutes);

// 404
app.use((_req, res) => res.status(404).json({ success: false, error: 'Ruta no encontrada' }));

// Error handler global
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { err });
  res.status(500).json({ success: false, error: 'Error interno del servidor' });
});

export default app;
