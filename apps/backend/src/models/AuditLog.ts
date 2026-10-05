// --------------- VAIBHAV TYAGI WORK ----------------
import mongoose, { Schema, Document as MongooseDocument } from 'mongoose';

export interface IAuditLog extends MongooseDocument {
  documentId: string;
  actorId: string;
  action: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

const AuditLogSchema: Schema = new Schema(
  {
    documentId: { type: String, required: true, index: true },
    actorId: { type: String, required: true, index: true },
    action: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AuditLogModel = mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
