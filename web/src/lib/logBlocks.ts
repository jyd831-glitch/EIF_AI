/** Detect TRACE / SFC style message header lines. */
const LOG_HEADER =
  /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\[\w+\]\s+\[[^\]]+\]\s+\[[^\]]+\]/;

const TS_PREFIX =
  /^(?<y>\d{4})-(?<mo>\d{2})-(?<d>\d{2})\s+(?<h>\d{2}):(?<mi>\d{2}):(?<s>\d{2})(?:\.(?<ms>\d+))?/;

export function isLogMessageHeader(line: string): boolean {
  if (!LOG_HEADER.test(line)) return false;
  // TRACE: ...] (Boolean|Structure) : ...
  // SFC: ...] DIRECTION MsgType :
  return /\([^)]+\)\s*:/.test(line) || /\]\s+\S+.*:/.test(line);
}

export function parseLogTimestamp(line: string): Date | null {
  const m = line.match(TS_PREFIX);
  if (!m?.groups) return null;
  const ms = (m.groups.ms || "0").padEnd(3, "0").slice(0, 3);
  const iso = `${m.groups.y}-${m.groups.mo}-${m.groups.d}T${m.groups.h}:${m.groups.mi}:${m.groups.s}.${ms}`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function timeToMinutes(hhmm: string): number | null {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function isTimestampInRange(
  ts: Date,
  date: string,
  timeFrom: string,
  timeTo: string
): boolean {
  if (date.trim()) {
    const y = ts.getFullYear();
    const mo = String(ts.getMonth() + 1).padStart(2, "0");
    const d = String(ts.getDate()).padStart(2, "0");
    if (`${y}-${mo}-${d}` !== date.trim()) return false;
  }

  const mins = ts.getHours() * 60 + ts.getMinutes();
  const fromM = timeToMinutes(timeFrom);
  const toM = timeToMinutes(timeTo);
  if (fromM == null && toM == null) return true;
  const lo = fromM ?? 0;
  const hi = toM ?? 23 * 60 + 59;
  if (lo <= hi) return mins >= lo && mins <= hi;
  // overnight range e.g. 22:00 ~ 06:00
  return mins >= lo || mins <= hi;
}

export function findMessageBlockRange(
  lines: string[],
  hitIndex: number
): { start: number; end: number } {
  let start = Math.max(0, Math.min(hitIndex, lines.length - 1));

  while (start > 0 && !isLogMessageHeader(lines[start])) {
    start--;
  }
  if (!isLogMessageHeader(lines[start])) {
    start = hitIndex;
    while (start > 0 && lines[start - 1].trim()) start--;
    let end = hitIndex;
    while (end + 1 < lines.length && lines[end + 1].trim()) end++;
    return { start, end };
  }

  let end = start;
  while (end + 1 < lines.length) {
    const next = lines[end + 1];
    if (!next.trim()) break;
    if (isLogMessageHeader(next)) break;
    end++;
  }
  return { start, end };
}

export type MessageBlock = {
  start: number;
  end: number;
  timestamp?: Date;
  lines: { n: number; text: string; hit: boolean }[];
};

function buildBlock(
  lines: string[],
  start: number,
  end: number,
  query: string
): MessageBlock {
  const q = query.trim().toLowerCase();
  const blockLines = [];
  for (let i = start; i <= end; i++) {
    blockLines.push({
      n: i + 1,
      text: lines[i],
      hit: !!q && lines[i].toLowerCase().includes(q),
    });
  }
  return {
    start,
    end,
    timestamp: parseLogTimestamp(lines[start]) ?? undefined,
    lines: blockLines,
  };
}

export type TimeFilterOpts = {
  date?: string;
  timeFrom?: string;
  timeTo?: string;
};

function passesTimeFilter(block: MessageBlock, opts?: TimeFilterOpts): boolean {
  if (!opts) return true;
  const date = opts.date ?? "";
  const timeFrom = opts.timeFrom ?? "";
  const timeTo = opts.timeTo ?? "";
  if (!date.trim() && !timeFrom.trim() && !timeTo.trim()) return true;
  if (!block.timestamp) return !date.trim();
  return isTimestampInRange(block.timestamp, date, timeFrom, timeTo);
}

/** Expand keyword hits to full message blocks. Optional time filter is applied while collecting so early hits outside the window do not starve later matches. */
export function expandHitsToMessageBlocks(
  text: string,
  query: string,
  maxBlocks = Number.POSITIVE_INFINITY,
  timeOpts?: TimeFilterOpts
): { blocks: MessageBlock[]; truncated: boolean; totalLines: number } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const q = query.trim().toLowerCase();
  if (!q) return { blocks: [], truncated: false, totalLines: lines.length };

  const hitIndexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(q)) hitIndexes.push(i);
  }

  const seen = new Set<string>();
  const blocks: MessageBlock[] = [];
  let truncated = false;

  for (const hit of hitIndexes) {
    const { start, end } = findMessageBlockRange(lines, hit);
    const key = `${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const block = buildBlock(lines, start, end, query);
    if (!passesTimeFilter(block, timeOpts)) continue;
    blocks.push(block);
    if (blocks.length >= maxBlocks) {
      truncated = true;
      break;
    }
  }

  return { blocks, truncated, totalLines: lines.length };
}

/** Collect every message block whose header timestamp falls in the range (no default cap). */
export function extractMessageBlocksInRange(
  text: string,
  date: string,
  timeFrom: string,
  timeTo: string,
  maxBlocks = Number.POSITIVE_INFINITY
): { blocks: MessageBlock[]; truncated: boolean; totalLines: number } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MessageBlock[] = [];
  let i = 0;
  let truncated = false;
  while (i < lines.length) {
    if (!isLogMessageHeader(lines[i])) {
      i++;
      continue;
    }
    const { start, end } = findMessageBlockRange(lines, i);
    const block = buildBlock(lines, start, end, "");
    const ts = block.timestamp;
    if (!ts || isTimestampInRange(ts, date, timeFrom, timeTo)) {
      blocks.push(block);
      if (blocks.length >= maxBlocks) {
        truncated = true;
        break;
      }
    }
    i = end + 1;
  }
  return { blocks, truncated, totalLines: lines.length };
}

export function filterBlocksByTimeRange(
  blocks: MessageBlock[],
  date: string,
  timeFrom: string,
  timeTo: string
): MessageBlock[] {
  if (!date.trim() && !timeFrom.trim() && !timeTo.trim()) return blocks;
  return blocks.filter((b) => {
    if (!b.timestamp) return !date.trim();
    return isTimestampInRange(b.timestamp, date, timeFrom, timeTo);
  });
}

export function guessLogDate(text: string): string {
  const m = text.match(/(\d{4}-\d{2}-\d{2})/);
  return m?.[1] || "";
}
