import { config, isProduction } from '../config.js';
import type { VerificationStatus } from '../models/document.js';

/**
 * M7 — verification adapter. Authenticity can only come from an authorised issuing authority.
 * Every provider declares whether it is simulated; simulated results are never treated as verification.
 */

export interface VerificationInput {
  documentType: string;
  fields: Record<string, string | null>;
}

export interface ProviderResponse {
  outcome: 'match' | 'mismatch' | 'not_found';
  reference?: string;
  mismatches?: Array<{ field: string; submitted: string; authority: string }>;
}

export interface VerificationProvider {
  id: string;
  label: string;
  simulated: boolean;
  verify(input: VerificationInput): Promise<ProviderResponse>;
}

const IDENTIFIER_FIELDS: Record<string, string> = {
  marksheet: 'roll_number',
  income_certificate: 'certificate_number',
  identity: 'id_number',
};

export class SimulatedProvider implements VerificationProvider {
  readonly id = 'simulated';
  readonly label = 'SIMULATED PROVIDER — demonstration only, not an authorised source';
  readonly simulated = true;

  async verify(input: VerificationInput): Promise<ProviderResponse> {
    const identifier = input.fields[IDENTIFIER_FIELDS[input.documentType]];
    if (!identifier) return { outcome: 'not_found' };
    return { outcome: 'match', reference: `SIM-${identifier}` };
  }
}

/** Generic REST adapter for an authorised registry (university records, examination board, DigiLocker gateway). */
export class RegistryProvider implements VerificationProvider {
  readonly id = 'registry';
  readonly simulated = false;
  constructor(private readonly baseUrl: string, private readonly apiKey: string, readonly label = 'Authorised registry') {}

  async verify(input: VerificationInput): Promise<ProviderResponse> {
    const res = await fetch(`${this.baseUrl}/v1/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ documentType: input.documentType, identifier: input.fields[IDENTIFIER_FIELDS[input.documentType]], fields: input.fields }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) return { outcome: 'not_found' };
    if (!res.ok) throw new Error(`Registry responded ${res.status}`);
    const body = (await res.json()) as { status: string; reference?: string; mismatches?: ProviderResponse['mismatches'] };
    return { outcome: body.status === 'match' ? 'match' : 'mismatch', reference: body.reference, mismatches: body.mismatches };
  }
}

export class ProviderConfigError extends Error {}

export function resolveProvider(settings: { verificationProvider?: string | null; registryBaseUrl?: string | null }): VerificationProvider | null {
  switch (settings.verificationProvider) {
    case 'simulated':
      if (isProduction()) throw new ProviderConfigError('The simulated verification provider cannot be used in production');
      return new SimulatedProvider();
    case 'registry': {
      const key = config().REGISTRY_API_KEY;
      if (!settings.registryBaseUrl || !key) throw new ProviderConfigError('Registry provider needs a base URL and REGISTRY_API_KEY');
      return new RegistryProvider(settings.registryBaseUrl, key);
    }
    default:
      return null; // manual verification only
  }
}

export function statusFor(outcome: ProviderResponse['outcome'], source: 'authority' | 'simulated' | 'manual'): VerificationStatus {
  if (source === 'simulated') return outcome === 'match' ? 'simulated_match' : 'simulated_mismatch';
  if (source === 'manual') return outcome === 'match' ? 'manual_match' : 'manual_mismatch';
  return outcome === 'match' ? 'authority_match' : outcome === 'mismatch' ? 'authority_mismatch' : 'authority_not_found';
}

/** Plain-language statement of what the system has established about a document. */
export function authenticityStatement(status: VerificationStatus): { established: boolean; text: string } {
  switch (status) {
    case 'authority_match':
      return { established: true, text: 'Confirmed by the issuing authority.' };
    case 'manual_match':
      return { established: true, text: 'Confirmed by an officer directly with the issuing authority.' };
    case 'authority_mismatch':
    case 'manual_mismatch':
      return { established: false, text: 'The issuing authority reported details that do not match this document.' };
    case 'authority_not_found':
      return { established: false, text: 'The issuing authority has no record matching this document.' };
    case 'simulated_match':
    case 'simulated_mismatch':
      return { established: false, text: 'Only a simulated check was run. Authenticity has NOT been established.' };
    default:
      return { established: false, text: 'Not verified. Values were extracted and checked for internal consistency only; authenticity has not been established.' };
  }
}
