import { BundleOffer, EntitlementItem, OfferDisplayGroup, StorefrontMembership } from '../types/entitlement';
import { parseManagedData } from './projectSchema';

export const MANIFEST_BEGIN = '# UEFN_ENTITLEMENT_MANAGER_DATA_BEGIN';
export const MANIFEST_END = '# UEFN_ENTITLEMENT_MANAGER_DATA_END';
const MANIFEST_LINE = '# UEM_DATA ';

export interface VerseParseResult {
  entitlements: EntitlementItem[];
  bundles: BundleOffer[];
  storefrontMembership: StorefrontMembership;
  /** @deprecated Use storefrontMembership.focused. */
  offerDisplayGroups: OfferDisplayGroup[];
  retiredVerseKeys: string[];
  projectDataDiagnostics: string[];
  managed: boolean;
  error?: string;
}

function decodeBase64Utf8(encoded: string): string {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function parseVerseCode(verseCode: string): VerseParseResult {
  const begin = verseCode.indexOf(MANIFEST_BEGIN);
  const end = verseCode.indexOf(MANIFEST_END);

  if (begin < 0 || end < 0 || end <= begin) {
    return {
      entitlements: [],
      bundles: [],
      storefrontMembership: { allOffers: [], focused: [] },
      offerDisplayGroups: [],
      retiredVerseKeys: [],
      projectDataDiagnostics: [],
      managed: false,
      error: 'This Verse file has no Entitlement Manager manifest. It was left untouched because unmanaged Verse cannot be imported without losing data.',
    };
  }

  try {
    const manifestBlock = verseCode.slice(begin + MANIFEST_BEGIN.length, end);
    const encoded = manifestBlock
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.startsWith(MANIFEST_LINE))
      .map(line => line.slice(MANIFEST_LINE.length))
      .join('');

    if (!encoded) throw new Error('The embedded manifest is empty.');
    const raw = JSON.parse(decodeBase64Utf8(encoded)) as unknown;
    const data = parseManagedData(raw);

    return { ...data, managed: true };
  } catch (error) {
    return {
      entitlements: [],
      bundles: [],
      storefrontMembership: { allOffers: [], focused: [] },
      offerDisplayGroups: [],
      retiredVerseKeys: [],
      projectDataDiagnostics: [],
      managed: true,
      error: error instanceof Error ? `The embedded manifest is invalid: ${error.message}` : 'The embedded manifest is invalid.',
    };
  }
}
