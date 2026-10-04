// --------------- VAIBHAV TYAGI WORK ----------------
import mongoose, { Schema, Document as MongooseDocument } from 'mongoose';
import { DocumentStatusSchema } from '@certischolar/shared';

export interface IDocument extends MongooseDocument {
  documentId: string;
  ownerId: string;
  applicationId?: string;
  originalFilename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  requestedType: string;
  status: string;
  scanDetails?: {
    scannerName?: string;
    version?: string;
    timestamp?: Date;
    error?: string;
    virusName?: string;
  };
  retentionDetails?: {
    expiresAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const DocumentSchema: Schema = new Schema(
  {
    documentId: { type: String, required: true, unique: true, index: true },
    ownerId: { type: String, required: true, index: true },
    applicationId: { type: String, index: true },
    originalFilename: { type: String, required: true },
    storageKey: { type: String, required: true, unique: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    checksum: { type: String, required: true, index: true },
    requestedType: { type: String, required: true },
    status: { 
      type: String, 
      required: true, 
      enum: DocumentStatusSchema.options,
      default: 'new' 
    },
    scanDetails: {
      scannerName: String,
      version: String,
      timestamp: Date,
      error: String,
      virusName: String
    },
    retentionDetails: {
      expiresAt: Date
    }
  },
  { timestamps: true }
);

// Compound index for idempotency
DocumentSchema.index({ ownerId: 1, checksum: 1, requestedType: 1 });

export const DocumentModel = (mongoose.models.Document as mongoose.Model<IDocument>) || mongoose.model<IDocument>('Document', DocumentSchema);
