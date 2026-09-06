import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const ROLES = ['student', 'verifier', 'scholarship_officer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
    // Applicant profile, self-declared; used as rule facts and shown as such.
    profile: {
      category: { type: String, enum: ['GEN', 'EWS', 'OBC', 'SC', 'ST'] },
      gender: { type: String, enum: ['female', 'male', 'other'] },
      state: String,
      phone: String,
    },
  },
  { timestamps: true },
);

export type User = InferSchemaType<typeof UserSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = model('User', UserSchema);
