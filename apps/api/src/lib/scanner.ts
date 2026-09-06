import { connect } from 'node:net';
import { config } from '../config.js';

export interface ScanResult {
  clean: boolean;
  signature?: string;
  engine: string;
}

export interface MalwareScanner {
  scan(data: Buffer): Promise<ScanResult>;
}

/** clamd INSTREAM protocol. */
export class ClamAvScanner implements MalwareScanner {
  constructor(private readonly host: string, private readonly port: number, private readonly timeoutMs = 15_000) {}

  scan(data: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.port, this.host);
      const chunks: Buffer[] = [];
      socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error('ClamAV scan timed out')));
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let i = 0; i < data.length; i += 64 * 1024) {
          const chunk = data.subarray(i, i + 64 * 1024);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length);
          socket.write(Buffer.concat([len, chunk]));
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on('data', (d) => chunks.push(Buffer.from(d)));
      socket.on('error', reject);
      socket.on('end', () => {
        const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
        if (reply.endsWith('OK')) return resolve({ clean: true, engine: 'clamav' });
        const found = reply.match(/: (.+) FOUND$/);
        if (found) return resolve({ clean: false, signature: found[1], engine: 'clamav' });
        reject(new Error(`Unexpected ClamAV reply: ${reply}`));
      });
    });
  }
}

const EICAR = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`;

/** Development/test only: recognises the EICAR test signature. Rejected by config in production. */
export class SignatureScanner implements MalwareScanner {
  async scan(data: Buffer): Promise<ScanResult> {
    return data.toString('latin1').includes(EICAR)
      ? { clean: false, signature: 'EICAR-Test-Signature', engine: 'signature' }
      : { clean: true, engine: 'signature' };
  }
}

let scanner: MalwareScanner | undefined;
export function malwareScanner(): MalwareScanner {
  const c = config();
  return (scanner ??=
    c.MALWARE_SCANNER === 'clamav' ? new ClamAvScanner(c.CLAMAV_HOST, c.CLAMAV_PORT) : new SignatureScanner());
}
