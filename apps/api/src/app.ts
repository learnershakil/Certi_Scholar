import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import mongoose from 'mongoose';
import { authenticate, errorHandler } from './lib/http.js';
import { logger } from './lib/events.js';
import { auth } from './routes/auth.js';
import { documents } from './routes/documents.js';
import { files } from './routes/files.js';
import { scholarships } from './routes/scholarships.js';
import { applications } from './routes/applications.js';
import { reports } from './routes/reports.js';
import { admin } from './routes/admin.js';
import { DocumentTypeModel } from './models/document.js';
import { getSettings } from './models/system.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(pinoHttp({ logger, autoLogging: process.env.NODE_ENV !== 'test' }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    const db = mongoose.connection.readyState === 1;
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db });
  });

  const v1 = express.Router();
  v1.use('/auth', auth);
  // Public: the sign-in page needs the product wording and role names before anyone signs in. Nothing private here.
  v1.get('/branding', async (_req, res) => {
    const s = await getSettings();
    res.json({ branding: s.branding ?? {}, roleLabels: s.roleLabels ?? {} });
  });
  v1.use(authenticate);
  // The document types the system knows; every dropdown and label in the web app is built from this.
  v1.get('/document-types', async (_req, res) => {
    res.json(await DocumentTypeModel.find({ active: true }).select('code name -_id').sort({ name: 1 }).lean());
  });
  v1.use('/documents', documents);
  v1.use('/files', files);
  v1.use('/scholarships', scholarships);
  v1.use('/applications', applications);
  v1.use('/reports', reports);
  v1.use('/admin', admin);
  app.use('/api/v1', v1);

  app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } }));
  app.use(errorHandler);
  return app;
}
