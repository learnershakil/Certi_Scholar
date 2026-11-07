import type { Types } from 'mongoose';
import { ApplicationModel } from '../models/scholarship.js';
import { DocumentModel } from '../models/document.js';
import { jobQueue } from '../pipeline/queue.js';

/**
 * The applicant's identity details. A student enters each one once (at first sign-in); after that only a
 * verification officer or an administrator can change them, with a recorded reason. Documents are matched
 * against them, and gender and state are eligibility facts.
 */
export const APPLICANT_DETAILS = ['name', 'fatherName', 'motherName', 'gender', 'state'] as const;
export type ApplicantDetail = (typeof APPLICANT_DETAILS)[number];

export const DETAIL_LABELS: Record<ApplicantDetail, string> = {
  name: 'full name',
  fatherName: "father's name",
  motherName: "mother's name",
  gender: 'gender',
  state: 'state of domicile',
};

type Person = { role: string; name?: string | null; profile?: Partial<Record<Exclude<ApplicantDetail, 'name'>, string | null>> | null };

export const detailValue = (u: Person, key: ApplicantDetail) => (key === 'name' ? u.name : u.profile?.[key]) ?? undefined;

/** Everyone needs a name; a student also needs every applicant detail before using the rest of the app. */
export const profileComplete = (u: Person) =>
  u.role === 'student' ? APPLICANT_DETAILS.every((k) => Boolean(detailValue(u, k))) : Boolean(u.name);

/** After details change: re-check open applications and re-match the student's documents against the new details. */
export async function applicantDetailsChanged(userId: Types.ObjectId | string) {
  const open = await ApplicationModel.find({ student: userId, status: { $in: ['submitted', 'under_review', 'evaluated'] } }).select('_id').lean();
  for (const a of open) await jobQueue().add('application.evaluate', { applicationId: String(a._id) }, { jobId: `evaluate-${a._id}-${Date.now()}` });
  const docs = await DocumentModel.find({ owner: userId, documentType: { $ne: null }, status: { $in: ['needs_review', 'processed'] } }).select('_id').lean();
  for (const d of docs) await jobQueue().add('document.profile-match', { documentId: String(d._id) }, { jobId: `profile-match-${d._id}-${Date.now()}` });
}
