import type { JobHandler, JobName } from './queue.js';
import { runAnalyse, runOcr, runRetention } from './documentPipeline.js';
import { runVerification } from '../services/verification.js';
import { evaluateApplication } from '../services/recommendation.js';

export const handlers: Record<JobName, JobHandler> = {
  'document.ocr': (d, ctx) => runOcr(d.documentId, ctx),
  'document.analyse': (d) => runAnalyse(d.documentId),
  'document.verify': (d, ctx) => runVerification(d.requestId, ctx),
  'application.evaluate': async (d) => void (await evaluateApplication(d.applicationId)),
  'maintenance.retention': async () => void (await runRetention()),
};
