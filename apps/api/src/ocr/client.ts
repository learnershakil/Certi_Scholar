import { z } from 'zod';
import { config } from '../config.js';

/**
 * Client for the Python OCR service. Contract: docs/ocr-contract-v1.md.
 * Requests and responses are validated against the versioned schema; any mismatch is a retryable failure.
 */
export const OCR_CONTRACT_VERSION = '1';

const bbox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const word = z.object({ text: z.string(), conf: z.number().min(0).max(1), bbox });
export const ocrResultSchema = z.object({
  contractVersion: z.literal(OCR_CONTRACT_VERSION),
  provider: z.string(),
  durationMs: z.number(),
  pages: z.array(
    z.object({
      index: z.number(),
      width: z.number(),
      height: z.number(),
      lines: z.array(z.object({ text: z.string(), words: z.array(word) })),
    }),
  ),
  preview: z.object({ mime: z.literal('image/png'), base64: z.string() }).nullable(),
});
export type OcrResult = z.infer<typeof ocrResultSchema>;
export type OcrWord = z.infer<typeof word>;

export class OcrServiceError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

export interface OcrClient {
  recognise(file: Buffer, mime: string, filename: string): Promise<OcrResult>;
  health(): Promise<{ ok: boolean; providers?: string[] }>;
}

export class HttpOcrClient implements OcrClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs: number) {}

  async recognise(file: Buffer, mime: string, filename: string): Promise<OcrResult> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)], { type: mime }), filename);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/ocr`, {
        method: 'POST',
        body: form,
        headers: { 'X-Contract-Version': OCR_CONTRACT_VERSION },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new OcrServiceError(`OCR service unreachable: ${(err as Error).message}`, true);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const retryable = body?.error?.retryable ?? res.status >= 500;
      throw new OcrServiceError(`OCR service ${res.status}: ${body?.error?.message ?? res.statusText}`, retryable);
    }
    const parsed = ocrResultSchema.safeParse(body);
    if (!parsed.success) throw new OcrServiceError(`OCR contract violation: ${parsed.error.issues[0]?.message}`, true);
    return parsed.data;
  }

  async health() {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? { ok: true, ...((await res.json()) as object) } : { ok: false };
    } catch {
      return { ok: false };
    }
  }
}

let client: OcrClient | undefined;
export const ocrClient = (): OcrClient => (client ??= new HttpOcrClient(config().OCR_SERVICE_URL, config().OCR_TIMEOUT_MS));
export const setOcrClient = (c: OcrClient) => (client = c);
