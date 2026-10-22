import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;

/** A node of the rule tree: either an AND/OR group or a single condition. */
const RuleConditionSchema = new Schema(
  {
    type: { type: String, enum: ['group', 'condition'], required: true },
    op: { type: String, enum: ['AND', 'OR'] },
    fact: String,
    operator: String,
    value: Mixed,
    label: String,
  },
  { _id: false },
);
RuleConditionSchema.add({ children: { type: [RuleConditionSchema], default: undefined } });

const ScholarshipSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: String,
    sponsor: String,
    amount: Number,
    deadline: Date,
    requiredDocuments: [{ type: String }],
    officers: [{ type: ObjectId, ref: 'User' }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

/** Rules are versioned: every save creates a new version so past recommendations stay reproducible. */
const ScholarshipRuleSchema = new Schema(
  {
    scholarship: { type: ObjectId, ref: 'Scholarship', required: true, index: true },
    version: { type: Number, required: true },
    root: { type: RuleConditionSchema, required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: ObjectId, ref: 'User' },
    changeNote: String,
  },
  { timestamps: true },
);
ScholarshipRuleSchema.index({ scholarship: 1, version: -1 }, { unique: true });

export const APPLICATION_STATUSES = ['submitted', 'under_review', 'evaluated', 'awarded', 'rejected', 'withdrawn'] as const;

const ApplicationSchema = new Schema(
  {
    student: { type: ObjectId, ref: 'User', required: true, index: true },
    scholarship: { type: ObjectId, ref: 'Scholarship', required: true, index: true },
    documents: [{ type: ObjectId, ref: 'Document' }],
    status: { type: String, enum: APPLICATION_STATUSES, default: 'submitted', index: true },
    latestRecommendation: { type: ObjectId, ref: 'Recommendation' },
    decision: {
      outcome: { type: String, enum: ['awarded', 'rejected'] },
      note: String,
      by: { type: ObjectId, ref: 'User' },
      at: Date,
    },
  },
  { timestamps: true },
);
ApplicationSchema.index({ student: 1, scholarship: 1 }, { unique: true });

const RecommendationSchema = new Schema(
  {
    application: { type: ObjectId, ref: 'Application', required: true, index: true },
    ruleVersion: Number,
    outcome: { type: String, enum: ['recommended', 'not_recommended', 'needs_review'], required: true },
    summary: String,
    evaluation: Mixed, // full condition-by-condition tree
    facts: Mixed, // fact -> { value, source, confidence, status }
    authenticity: Mixed, // per document: what has and has not been established
    generatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const ScholarshipModel = model('Scholarship', ScholarshipSchema);
export const ScholarshipRuleModel = model('ScholarshipRule', ScholarshipRuleSchema);
export const ApplicationModel = model('Application', ApplicationSchema);
export const RecommendationModel = model('Recommendation', RecommendationSchema);

export type ApplicationRecord = HydratedDocument<InferSchemaType<typeof ApplicationSchema>>;
