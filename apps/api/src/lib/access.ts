import { Types } from 'mongoose';
import { DocumentModel } from '../models/document.js';
import { ApplicationModel, ScholarshipModel } from '../models/scholarship.js';
import { forbidden, notFound } from './errors.js';
import type { Actor } from './events.js';

/** Scholarship ids an officer is assigned to. */
export async function officerScholarships(actor: Actor) {
  return (await ScholarshipModel.find({ officers: actor.id }).select('_id').lean()).map((s) => s._id);
}

/**
 * Case-based access: students see their own documents, verifiers see documents assigned to them,
 * scholarship officers see documents attached to applications for their scholarships, admins see all.
 */
export async function documentScope(actor: Actor): Promise<Record<string, unknown>> {
  switch (actor.role) {
    case 'admin':
      return {};
    case 'student':
      return { owner: new Types.ObjectId(actor.id) };
    case 'verifier':
      return { assignedTo: new Types.ObjectId(actor.id) };
    case 'scholarship_officer': {
      const apps = await ApplicationModel.find({ scholarship: { $in: await officerScholarships(actor) } }).select('documents').lean();
      return { _id: { $in: apps.flatMap((a) => a.documents) } };
    }
    default:
      return { _id: null };
  }
}

export async function loadDocument(actor: Actor, id: string, opts: { write?: boolean } = {}) {
  if (!Types.ObjectId.isValid(id)) throw notFound('Document');
  const doc = await DocumentModel.findOne({ _id: id, ...(await documentScope(actor)) });
  if (!doc) {
    // Distinguish "does not exist" from "not yours" only for staff; students always get 404.
    if (actor.role !== 'student' && (await DocumentModel.exists({ _id: id }))) throw forbidden('This document is not assigned to you');
    throw notFound('Document');
  }
  if (opts.write && !['verifier', 'admin'].includes(actor.role)) throw forbidden();
  return doc;
}

export async function applicationScope(actor: Actor): Promise<Record<string, unknown>> {
  switch (actor.role) {
    case 'admin':
      return {};
    case 'student':
      return { student: new Types.ObjectId(actor.id) };
    case 'scholarship_officer':
      return { scholarship: { $in: await officerScholarships(actor) } };
    default:
      return { _id: null };
  }
}

export async function loadApplication(actor: Actor, id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound('Application');
  const app = await ApplicationModel.findOne({ _id: id, ...(await applicationScope(actor)) });
  if (!app) throw notFound('Application');
  return app;
}
