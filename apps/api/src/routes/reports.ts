import { Router } from 'express';
import { Types } from 'mongoose';
import { ConsistencyCheckModel, CorrectionModel, DocumentModel, ExtractedFieldModel, VerificationResultModel } from '../models/document.js';
import { ApplicationModel, RecommendationModel } from '../models/scholarship.js';
import { AuditEntryModel, ProcessingTimelineModel } from '../models/system.js';
import { actor, requireRole } from '../lib/http.js';
import { applicationScope } from '../lib/access.js';

export const reports = Router();
reports.use(requireRole('scholarship_officer', 'admin'));

const toMap = (rows: Array<{ _id: unknown; n: number }>) => Object.fromEntries(rows.map((r) => [String(r._id), r.n]));

reports.get('/summary', async (req, res) => {
  const scope = await applicationScope(actor(req));
  const since = new Date(Date.now() - 24 * 3600_000);

  const [appsByStatus, appsByScholarship, docsByStatus, fieldsByKey, correctionsByKey, consistency, verification, outcomes, stageTimes, throughput, officerActions, processedLastHour] =
    await Promise.all([
      ApplicationModel.aggregate([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      ApplicationModel.aggregate([
        { $match: scope },
        { $group: { _id: '$scholarship', n: { $sum: 1 }, awarded: { $sum: { $cond: [{ $eq: ['$status', 'awarded'] }, 1, 0] } } } },
        { $lookup: { from: 'scholarships', localField: '_id', foreignField: '_id', as: 's' } },
        { $project: { name: { $first: '$s.name' }, n: 1, awarded: 1 } },
      ]),
      DocumentModel.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      ExtractedFieldModel.aggregate([
        { $lookup: { from: 'documents', localField: 'document', foreignField: '_id', as: 'd' } },
        { $group: { _id: { type: { $first: '$d.documentType' }, key: { $ifNull: ['$group', '$key'] } }, n: { $sum: 1 }, lowConfidence: { $sum: { $cond: [{ $lt: ['$confidence.overall', '$confidence.threshold'] }, 1, 0] } } } },
      ]),
      CorrectionModel.aggregate([{ $group: { _id: { type: '$documentType', key: '$fieldKey' }, n: { $sum: 1 } } }]),
      ConsistencyCheckModel.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      VerificationResultModel.aggregate([{ $group: { _id: { outcome: '$outcome', simulated: '$simulated' }, n: { $sum: 1 } } }]),
      RecommendationModel.aggregate([
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$application', outcome: { $first: '$outcome' } } },
        { $group: { _id: '$outcome', n: { $sum: 1 } } },
      ]),
      ProcessingTimelineModel.aggregate([
        { $match: { durationMs: { $exists: true } } },
        { $group: { _id: '$stage', avgMs: { $avg: '$durationMs' }, maxMs: { $max: '$durationMs' }, n: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } } } },
      ]),
      ProcessingTimelineModel.aggregate([
        { $match: { stage: 'consistency', status: 'done', createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%dT%H:00', date: '$createdAt' } }, n: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      AuditEntryModel.aggregate([
        { $match: { action: { $in: ['field.corrected', 'review.completed', 'application.decided', 'verification.manual'] }, createdAt: { $gte: new Date(Date.now() - 30 * 86_400_000) } } },
        { $group: { _id: { actor: '$actor', action: '$action' }, n: { $sum: 1 } } },
        { $lookup: { from: 'users', localField: '_id.actor', foreignField: '_id', as: 'u' } },
        { $project: { name: { $first: '$u.name' }, action: '$_id.action', n: 1, _id: 0 } },
      ]),
      ProcessingTimelineModel.countDocuments({ stage: 'consistency', status: 'done', createdAt: { $gte: new Date(Date.now() - 3600_000) } }),
    ]);

  const corrections = new Map(correctionsByKey.map((c) => [`${c._id.type}|${c._id.key.replace(/\.\d+\./, '.')}`, c.n]));
  const consistencyMap = toMap(consistency);
  const applicable = (consistencyMap.pass ?? 0) + (consistencyMap.fail ?? 0);
  const authoritative = verification.filter((v) => !v._id.simulated);
  const authTotal = authoritative.reduce((s, v) => s + v.n, 0);

  res.json({
    applicationsByStatus: toMap(appsByStatus),
    applicationsByScholarship: appsByScholarship,
    documentsByStatus: toMap(docsByStatus),
    extraction: fieldsByKey
      .map((f) => {
        const key = String(f._id.key);
        const corrected = corrections.get(`${f._id.type}|${key}`) ?? [...corrections.entries()].filter(([k]) => k.startsWith(`${f._id.type}|${key}.`)).reduce((s, [, n]) => s + n, 0);
        return { documentType: f._id.type, field: key, extracted: f.n, lowConfidence: f.lowConfidence, corrected, correctionRate: f.n ? corrected / f.n : 0 };
      })
      .sort((a, b) => b.correctionRate - a.correctionRate),
    consistencyFailureRate: applicable ? (consistencyMap.fail ?? 0) / applicable : 0,
    verification: {
      authoritativeRequests: authTotal,
      authoritativeMatchRate: authTotal ? (authoritative.find((v) => v._id.outcome === 'match')?.n ?? 0) / authTotal : 0,
      simulatedResults: verification.filter((v) => v._id.simulated).reduce((s, v) => s + v.n, 0),
    },
    recommendationOutcomes: toMap(outcomes),
    stageTimings: stageTimes.map((s) => ({ stage: s._id, avgMs: Math.round(s.avgMs), maxMs: s.maxMs, runs: s.n, failureRate: s.n ? s.failed / s.n : 0 })),
    throughputByHour: throughput.map((t) => ({ hour: t._id, documents: t.n })),
    processedLastHour,
    officerThroughput: officerActions,
  });
});

const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Exportable award list. */
reports.get('/awards.csv', async (req, res) => {
  const filter: Record<string, unknown> = { ...(await applicationScope(actor(req))), status: 'awarded' };
  if (typeof req.query.scholarshipId === 'string' && Types.ObjectId.isValid(req.query.scholarshipId)) {
    filter.scholarship = new Types.ObjectId(req.query.scholarshipId);
  }
  const apps = await ApplicationModel.find(filter).populate('student', 'name email profile').populate('scholarship', 'code name amount').populate('decision.by', 'name').lean();
  const rows = [['Application', 'Scholarship', 'Student', 'Email', 'State', 'Amount', 'Decided by', 'Decided at', 'Note']];
  for (const a of apps as any[]) {
    rows.push([a._id, a.scholarship?.code, a.student?.name, a.student?.email, a.student?.profile?.state, a.scholarship?.amount, a.decision?.by?.name, a.decision?.at?.toISOString(), a.decision?.note]);
  }
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="award-list.csv"' });
  res.send(rows.map((r) => r.map(csv).join(',')).join('\r\n'));
});
