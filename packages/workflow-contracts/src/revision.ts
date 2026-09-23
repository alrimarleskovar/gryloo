export class RevisionConflictError extends Error {
  constructor(public readonly currentRevision: number, public readonly baseRevision: number) {
    super('BASE_REVISION_CONFLICT');
    this.name = 'RevisionConflictError';
  }
}

/** Check before accepting any patch. This pure helper performs no writes. */
export function nextRevision(currentRevision: number, baseRevision: number, materialChange: boolean): number {
  for (const value of [currentRevision, baseRevision]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid revision');
  }
  if (currentRevision !== baseRevision) throw new RevisionConflictError(currentRevision, baseRevision);
  if (!materialChange) return currentRevision;
  if (currentRevision === Number.MAX_SAFE_INTEGER) throw new Error('Revision overflow');
  return currentRevision + 1;
}
