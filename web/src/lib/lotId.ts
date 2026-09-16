/** Field names that can identify a lot / plate / barcode across SFC & TRACE. */
export const LOT_FIELD_KEYS = [
  "LOTID",
  "LOT_ID",
  "PLT_ID",
  "APD_PLT_ID",
  "BCR_ID",
  "APD_BCR_ID",
  "SETID",
  "BARCODE_VALUE",
] as const;

export function extractLotId(fields?: Record<string, string>): string | undefined {
  if (!fields) return undefined;
  for (const key of LOT_FIELD_KEYS) {
    const v = fields[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function collectLotCandidates(fields?: Record<string, string>): string[] {
  if (!fields) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of LOT_FIELD_KEYS) {
    const v = fields[key]?.trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

export function eventMatchesLot(
  event: { lotId?: string; fields?: Record<string, string> },
  lot: string
): boolean {
  const target = lot.trim().toLowerCase();
  if (!target) return false;
  if (event.lotId?.toLowerCase() === target) return true;
  return collectLotCandidates(event.fields).some((v) => v.toLowerCase() === target);
}
