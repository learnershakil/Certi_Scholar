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
    MAX_UPLOAD_BYTES: z.coerce.number().default(10 * 1024 * 1024),
    MALWARE_SCANNER: z.enum(['clamav', 'signature']).default('clamav'),
    CLAMAV_HOST: z.string().default('localhost'),
    CLAMAV_PORT: z.coerce.number().default(3310),
    REGISTRY_API_KEY: z.string().optional(),
    WEB_ORIGIN: z.string().default('http://localhost:3000'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
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
