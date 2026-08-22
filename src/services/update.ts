export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  distributionMode?: 'installed' | 'portable';
  availableVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  progress?: number;
  message?: string;
  dismissed?: boolean;
}

export interface UpdateCandidate {
  version: string;
  releaseName?: string;
  releaseNotes?: string | Array<{ note?: string }>;
  isDraft?: boolean;
  isPrerelease?: boolean;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().replace(/^v/i, '').match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

/** Compare two normal semantic versions, including numeric prerelease ordering. */
export function compareSemver(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Invalid semantic version: ${!a ? left : right}`);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

export function shouldOfferUpdate(currentVersion: string, candidate: UpdateCandidate): boolean {
  const parsedCandidate = parseVersion(candidate.version);
  if (!parsedCandidate || candidate.isDraft || candidate.isPrerelease || parsedCandidate.prerelease.length > 0) return false;
  return compareSemver(candidate.version, currentVersion) > 0;
}

export function plainReleaseNotes(notes: UpdateCandidate['releaseNotes']): string | undefined {
  if (!notes) return undefined;
  const text = Array.isArray(notes) ? notes.map(entry => entry.note ?? '').join('\n\n') : notes;
  const plain = text
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
  return plain ? plain.slice(0, 12000) : undefined;
}
