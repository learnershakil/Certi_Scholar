import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { InlineQueue, setJobQueue } from '../src/pipeline/queue.js';
import { handlers } from '../src/pipeline/handlers.js';
import { setOcrClient, type OcrClient, type OcrResult } from '../src/ocr/client.js';
import { DEMO_PASSWORD, seedDemo } from '../src/seedData.js';

/** Builds an OCR v1 result from text lines; `conf` lets a test lower confidence for chosen words. */
export function fakeOcr(lines: string[], conf: (word: string) => number = () => 0.97): OcrResult {
  return {
    contractVersion: '1',
    provider: 'fake',
    durationMs: 5,
    preview: { mime: 'image/png', base64: Buffer.from('preview-image').toString('base64') },
    pages: [
      {
        index: 0,
        width: 1000,
        height: 1400,
        lines: lines.map((text, li) => {
          let x = 0.05;
          return {
            text,
            words: text.split(/\s+/).map((w) => {
              const bbox: [number, number, number, number] = [x, 0.05 + li * 0.03, x + w.length * 0.012, 0.07 + li * 0.03];
              x = bbox[2] + 0.01;
              return { text: w, conf: conf(w), bbox };
            }),
          };
        }),
      },
    ],
  };
}

export const MARKSHEET = [
  'STATE BOARD OF HIGHER SECONDARY EDUCATION',
  'STATEMENT OF MARKS',
  'Name of Candidate: ANANYA SHARMA',
  'Roll Number: 2410387',
  'Year of Examination: 2025',
  'SUBJECT MAX MARKS OBTAINED',
  'English 100 88',
  'Mathematics 100 92',
  'Physics 100 85',
  'Chemistry 100 81',
  'Computer Science 100 95',
  'Total Marks Obtained: 441 / 500',
  'Percentage: 88.20',
];

export const INCOME = [
  'OFFICE OF THE TAHSILDAR NORTH DISTRICT',
  'INCOME CERTIFICATE',
  'Certificate No: INC/2026/004512',
  'Name: ANANYA SHARMA',
  'Annual Family Income: Rs. 2,40,000',
  `Date of Issue: 15/06/2026`,
  'Issuing Authority: Tahsildar North District',
];

export const IDENTITY = ['RESIDENT IDENTITY CARD', 'Name: ANANYA SHARMA', 'Date of Birth: 14/08/2007', 'Gender: Female', 'ID Number: 2345 6789 0124'];

/** OCR stub keyed by a marker embedded in the uploaded bytes, so each test controls what the "scan" contains. */
export class StubOcr implements OcrClient {
  results = new Map<string, OcrResult | Error>();
  calls = 0;
  async recognise(file: Buffer) {
    this.calls++;
    const marker = file.toString('latin1').match(/MARKER:(\w+)/)?.[1] ?? '';
    const r = this.results.get(marker);
    if (!r) throw new Error(`no stub for ${marker}`);
    if (r instanceof Error) throw r;
    return r;
  }
  async health() {
    return { ok: true };
  }
}

export const png = (marker: string) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`MARKER:${marker} `), Buffer.alloc(64)]);

export interface Harness {
  app: Express;
  queue: InlineQueue;
  ocr: StubOcr;
  stop: () => Promise<void>;
  login: (who: 'admin' | 'verifier' | 'officer' | 'student' | 'student2') => Promise<ReturnType<typeof request.agent>>;
}

export async function startHarness(): Promise<Harness> {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await seedDemo();
  const queue = new InlineQueue(handlers);
  setJobQueue(queue);
  const ocr = new StubOcr();
  setOcrClient(ocr);
  const app = createApp();
  return {
    app,
    queue,
    ocr,
    stop: async () => {
      await queue.drain();
      await mongoose.disconnect();
      await mongo.stop();
    },
    login: async (who) => {
      const agent = request.agent(app);
      await agent.post('/api/v1/auth/login').send({ email: `${who}@certischolar.local`, password: DEMO_PASSWORD }).expect(200);
      return agent;
    },
  };
}
