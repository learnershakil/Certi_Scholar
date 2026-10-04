// --------------- VAIBHAV TYAGI WORK ----------------
export interface ScannerProvider {
  scanFile(filePath: string): Promise<{ isInfected: boolean; virusName?: string; error?: string }>;
}

export class MockScannerProvider implements ScannerProvider {
  async scanFile(filePath: string): Promise<{ isInfected: boolean; virusName?: string; error?: string }> {
    // Simulate latency
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // For testing: if filename contains "eicar", flag as infected.
    if (filePath.toLowerCase().includes('eicar')) {
      return { isInfected: true, virusName: 'EICAR-Test-Signature' };
    }
    
    // Simulate random failures if needed, but keep it clean for default
    if (filePath.toLowerCase().includes('error')) {
      return { isInfected: false, error: 'Simulated scanner timeout' };
    }

    return { isInfected: false };
  }
}

// In production, we'd use clamscan or a remote API.
export class ClamAVScannerProvider implements ScannerProvider {
  private clamscan: any;

  async init() {
    const NodeClam = require('clamscan');
    this.clamscan = await new NodeClam().init({
      clamdscan: {
        host: process.env.CLAMAV_HOST || 'localhost',
        port: process.env.CLAMAV_PORT || 3310,
        timeout: 60000,
        local_fallback: false,
      }
    });
  }

  async scanFile(filePath: string): Promise<{ isInfected: boolean; virusName?: string; error?: string }> {
    try {
      const { isInfected, viruses } = await this.clamscan.isInfected(filePath);
      return { isInfected, virusName: viruses.length > 0 ? viruses[0] : undefined };
    } catch (err: any) {
      return { isInfected: false, error: err.message };
    }
  }
}

export async function getScannerProvider(): Promise<ScannerProvider> {
  const type = process.env.SCANNER_PROVIDER || (process.env.NODE_ENV === 'production' ? 'clamav' : 'mock');
  
  if (type === 'clamav') {
    const scanner = new ClamAVScannerProvider();
    await scanner.init();
    return scanner;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Mock scanner cannot be used in production environment');
  }

  return new MockScannerProvider();
}
