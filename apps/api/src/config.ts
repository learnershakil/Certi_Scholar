import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(4000),
    MONGO_URL: z.string().default('mongodb://localhost:27017/certischolar'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    QUEUE_DRIVER: z.enum(['bullmq', 'inline']).default('bullmq'),
    OCR_SERVICE_URL: z.string().url().default('http://localhost:8000'),
    OCR_TIMEOUT_MS: z.coerce.number().default(45_000),
    JWT_SECRET: z.string().min(32),
    PRESIGN_SECRET: z.string().min(32),
    PRESIGN_TTL_SECONDS: z.coerce.number().default(120),
    // 32-byte key, base64. Rotation: add a new key id, keep old keys readable.
    STORAGE_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'STORAGE_KEY must be 32 bytes base64'),
    STORAGE_KEY_ID: z.string().default('k1'),
    STORAGE_DIR: z.string().default('./.data/documents'),
    // Where encrypted documents are kept: a private volume (file) or a Cloudflare R2 bucket (r2).
    STORAGE_DRIVER: z.enum(['file', 'r2']).default('file'),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET_NAME: z.string().optional(),
    R2_ENDPOINT: z.string().url().optional(),
    R2_REGION: z.string().default('auto'),
    R2_KEY_PREFIX: z.string().default('documents/'),
    MAX_UPLOAD_BYTES: z.coerce.number().default(10 * 1024 * 1024),
    MALWARE_SCANNER: z.enum(['clamav', 'signature']).default('clamav'),
    CLAMAV_HOST: z.string().default('localhost'),
    CLAMAV_PORT: z.coerce.number().default(3310),
    REGISTRY_API_KEY: z.string().optional(),
    WEB_ORIGIN: z.string().default('http://localhost:3000'),
    // Sessions
    SESSION_TTL_HOURS: z.coerce.number().positive().max(72).default(8),
    // Background jobs
    JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    JOB_BACKOFF_MS: z.coerce.number().int().min(100).default(5_000),
    OCR_CONCURRENCY: z.coerce.number().int().min(1).default(4),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(8),
    RETENTION_CRON: z.string().default('0 2 * * *'),
    // Lists
    LIST_PAGE_SIZE: z.coerce.number().int().min(10).max(1000).default(200),
    // Seed data (reference data always; demo users only when SEED_DEMO=true)
    SEED_DIR: z.string().default('./seed'),
    SEED_DEMO: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    SEED_DEMO_PASSWORD: z.string().min(10).optional(),
    // Matching OCR'd details against the applicant's profile: 'groq' (LLM, needs GROQ_API_KEY) or 'basic' (exact rules).
    PROFILE_MATCH_PROVIDER: z.enum(['groq', 'basic']).default('basic'),
    GROQ_API_KEY: z.string().optional(),
    GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
    GROQ_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),
  })
  .superRefine((env, ctx) => {
    if (env.PROFILE_MATCH_PROVIDER === 'groq' && !env.GROQ_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['GROQ_API_KEY'], message: 'GROQ_API_KEY is required when PROFILE_MATCH_PROVIDER=groq' });
    }
    if (env.STORAGE_DRIVER === 'r2') {
      for (const key of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when STORAGE_DRIVER=r2' });
      }
      if (!env.R2_ENDPOINT && !env.R2_ACCOUNT_ID) {
        ctx.addIssue({ code: 'custom', path: ['R2_ACCOUNT_ID'], message: 'R2_ACCOUNT_ID or R2_ENDPOINT is required when STORAGE_DRIVER=r2' });
      }
    }
    if (env.SEED_DEMO && !env.SEED_DEMO_PASSWORD) {
      ctx.addIssue({ code: 'custom', path: ['SEED_DEMO_PASSWORD'], message: 'required when SEED_DEMO=true' });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.SEED_DEMO) {
      ctx.addIssue({ code: 'custom', path: ['SEED_DEMO'], message: 'demo accounts are never created in production' });
    }
    if (env.QUEUE_DRIVER === 'inline') {
      ctx.addIssue({ code: 'custom', path: ['QUEUE_DRIVER'], message: 'inline queue is test/dev only' });
    }
    if (env.MALWARE_SCANNER !== 'clamav') {
      ctx.addIssue({ code: 'custom', path: ['MALWARE_SCANNER'], message: 'production requires ClamAV' });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}

let cached: Config | undefined;
export const config = (): Config => (cached ??= loadConfig());
export const resetConfig = () => (cached = undefined);
export const isProduction = () => config().NODE_ENV === 'production';
