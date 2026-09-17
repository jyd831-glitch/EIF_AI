import type { LogFile, TimeFloorEvent, TimeFloorResult } from "./types";
import { toMessages } from "./sequence";
import { parseSfcLog } from "./parsers/sfc";
import { parseSolaceLog } from "./parsers/solace";
import { parseTraceLog } from "./parsers/trace";
import { isPcAscTrace, parsePcTraceLog } from "./parsers/pcTrace";
import { collectLotCandidates, eventMatchesLot } from "./lotId";

function normPath(p: string) {
  return p.replace(/\\/g, "/");
}

function filterByLot(all: TimeFloorEvent[], lot: string): TimeFloorEvent[] {
  const anchors = all.filter((e) => eventMatchesLot(e, lot));
  if (!anchors.length) return [];

  const selected = new Set<string>(anchors.map((a) => a.id));
  const orderedAnchors = [...anchors].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  type Cluster = { start: Date; end: Date; positions: Set<string> };
  const clusters: Cluster[] = [];
  let cStart: Date | null = null;
  let cEnd: Date = new Date(0);
  let positions = new Set<string>();

  const flush = () => {
    if (!cStart) return;
    // Pad so LOTID-less SFC (e.g. MSGID=2000) right after PLC lot request stays in range
    clusters.push({
      start: new Date(cStart.getTime() - 3000),
      end: new Date(cEnd.getTime() + 10000),
      positions: new Set(positions),
    });
    cStart = null;
    positions = new Set();
  };

  for (const a of orderedAnchors) {
    if (!cStart) {
      cStart = a.timestamp;
      cEnd = a.timestamp;
      if (a.position) positions.add(a.position);
      continue;
    }
    if ((a.timestamp.getTime() - cEnd.getTime()) / 1000 > 30) {
      flush();
      cStart = a.timestamp;
      cEnd = a.timestamp;
      if (a.position) positions.add(a.position);
    } else {
      cEnd = a.timestamp;
      if (a.position) positions.add(a.position);
    }
  }
  flush();

  for (const { start, end, positions: posSet } of clusters) {
    for (const e of all) {
      if (e.timestamp < start || e.timestamp > end) continue;
      if (eventMatchesLot(e, lot)) {
        selected.add(e.id);
        continue;
      }
      // Different LOT / PLT / BCR identity → skip
      const identities = collectLotCandidates(e.fields);
      if (e.lotId?.trim() && !identities.some((v) => v.toLowerCase() === e.lotId!.toLowerCase())) {
        identities.push(e.lotId);
      }
      if (identities.length > 0) continue;

      if (e.source === "Trace") {
        if (
          posSet.size === 0 ||
          (e.position && posSet.has(e.position)) ||
          orderedAnchors.some(
            (a) =>
              Math.abs(a.timestamp.getTime() - e.timestamp.getTime()) / 1000 <= 4 &&
              (!e.position || !a.position || a.position === e.position)
          )
        ) {
          selected.add(e.id);
        }
        continue;
      }

      // SFC / SOLACE without LOT fields in the same time cluster (e.g. MESSAGE ID : 2000)
      if (e.source === "Sfc") {
        selected.add(e.id);
      }
    }
  }

  return all.filter((e) => selected.has(e.id));
}

/**
 * Directory picker may omit SFC/SOLACE/TRACE in the path when that folder itself
 * was selected. Infer kind from the selected root name or common EIF file names.
 */
export function normalizeLogFilePaths(files: LogFile[], rootFolderName?: string): LogFile[] {
  const rootKind = rootFolderName?.toUpperCase().match(/^(SFC|SOLACE|TRACE)$/)?.[1];

  return files.map((f) => {
    let relativePath = normPath(f.relativePath);
    const parts = relativePath.split("/");
    const hasKind = parts.some((p) => /^(SFC|SOLACE|TRACE)$/i.test(p));

    if (!hasKind && rootKind) {
      relativePath = `${rootKind}/${relativePath}`;
    } else if (!hasKind) {
      const name = f.name.toUpperCase();
      if (/SOLACE|CALLBIZSOLACE/i.test(name)) relativePath = `SOLACE/${relativePath}`;
      else if (/VARIABLE_TRACE|\.PLC|TRACE/i.test(name)) relativePath = `TRACE/${relativePath}`;
      else if (/\bSFC\b|SFC_/i.test(name)) relativePath = `SFC/${relativePath}`;
    }

    return relativePath === normPath(f.relativePath) ? f : { ...f, relativePath };
  });
}

export function groupLogFiles(files: LogFile[]) {
  const groups = new Map<string, { sfc: LogFile[]; solace: LogFile[]; trace: LogFile[]; root: string }>();

  for (const f of normalizeLogFilePaths(files)) {
    const path = normPath(f.relativePath);
    const parts = path.split("/");
    const typeIdx = parts.findIndex((p) => /^(SFC|SOLACE|TRACE)$/i.test(p));
    if (typeIdx < 0) continue;
    const root = parts.slice(0, typeIdx).join("/") || "LOG";
    const kind = parts[typeIdx].toUpperCase();
    if (!groups.has(root)) groups.set(root, { sfc: [], solace: [], trace: [], root });
    const g = groups.get(root)!;
    if (kind === "SFC") g.sfc.push(f);
    else if (kind === "SOLACE") g.solace.push(f);
    else if (kind === "TRACE") g.trace.push(f);
  }

  return [...groups.values()];
}

export function collectLotIds(events: TimeFloorEvent[]): string[] {
  const set = new Set<string>();
  for (const e of events) {
    if (e.lotId?.trim()) set.add(e.lotId.trim());
    for (const v of collectLotCandidates(e.fields)) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function buildTimeFloor(
  files: LogFile[],
  lotId: string,
  includeBitOff: boolean
): TimeFloorResult {
  const groups = groupLogFiles(files);
  if (!groups.length) {
    throw new Error("SFC / SOLACE / TRACE 하위 폴더가 있는 로그를 선택하세요. (예: PCTYPE, PLCTYPE, SFCTYPE)");
  }

  const events: TimeFloorEvent[] = [];
  const roots: string[] = [];

  for (const g of groups) {
    roots.push(g.root);
    for (const f of g.sfc) events.push(...parseSfcLog(f.text, f.name));
    for (const f of g.solace) events.push(...parseSolaceLog(f.text, f.name));
    for (const f of g.trace) {
      if (isPcAscTrace(f.text)) events.push(...parsePcTraceLog(f.text, f.name));
      else events.push(...parseTraceLog(f.text, f.name, includeBitOff));
    }
  }

  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id.localeCompare(b.id));
  const lotIds = collectLotIds(events);
  const filtered = lotId.trim() ? filterByLot(events, lotId.trim()) : events;
  const list = filtered.slice(0, 2000);
  const messages = toMessages(list);

  return {
    sessionId: roots.join(", "),
    logType: roots.join(", "),
    equipmentKey: roots.join(", "),
    lotId: lotId.trim() || undefined,
    startTime: list[0]?.timestamp,
    endTime: list.at(-1)?.timestamp,
    totalEvents: list.length,
    lotIds,
    events: list,
    messages,
  };
}

export async function readFilesFromInput(fileList: FileList): Promise<LogFile[]> {
  const out: LogFile[] = [];
  for (const file of Array.from(fileList)) {
    if (!/\.log$/i.test(file.name)) continue;
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const text = await file.text();
    out.push({ name: file.name, relativePath, text, sourceFile: file });
  }
  return out;
}

/** Re-read previously selected File handles (no folder dialog). */
export async function rereadLogFiles(files: LogFile[]): Promise<LogFile[]> {
  const out: LogFile[] = [];
  for (const prev of files) {
    if (!prev.sourceFile) continue;
    if (!/\.log$/i.test(prev.sourceFile.name) && !/\.log$/i.test(prev.name)) continue;
    const file = prev.sourceFile;
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || prev.relativePath || file.name;
    out.push({
      name: file.name,
      relativePath,
      text: await file.text(),
      sourceFile: file,
    });
  }
  return out;
}

type DirHandle = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

type WindowWithDirPicker = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
};

/** True when the browser supports the File System Access folder picker (Select Folder / Open). */
export function canShowDirectoryPicker(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof (window as WindowWithDirPicker).showDirectoryPicker === "function"
  );
}

export function directoryPickerBlockedReason(): string | null {
  if (typeof window === "undefined") return null;
  if (!window.isSecureContext) {
    return "폴더 열기는 HTTPS 또는 localhost 에서만 가능합니다. http://로컬IP 로는 Upload 방식만 열려 보안 정책에 막힐 수 있습니다. https://eif-ai-mu.vercel.app 또는 http://localhost:3000 을 사용하세요.";
  }
  if (typeof (window as WindowWithDirPicker).showDirectoryPicker !== "function") {
    return "이 브라우저는 폴더 열기(showDirectoryPicker)를 지원하지 않습니다. Chrome/Edge 최신 버전을 사용하세요.";
  }
  return null;
}

/**
 * Native folder picker (mode: read) — not the webkitdirectory "Upload" dialog.
 * Returns null if the user cancels or the API is unavailable.
 */
export async function pickDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as WindowWithDirPicker).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker.call(window, { mode: "read" });
  } catch (e) {
    if (e instanceof DOMException && (e.name === "AbortError" || e.name === "NotAllowedError")) {
      return null;
    }
    throw e;
  }
}

export async function readFilesFromDirectoryHandle(
  root: FileSystemDirectoryHandle,
  basePath = ""
): Promise<LogFile[]> {
  const out: LogFile[] = [];
  for await (const [name, handle] of (root as DirHandle).entries()) {
    const relativePath = basePath ? `${basePath}/${name}` : name;
    if (handle.kind === "directory") {
      out.push(...(await readFilesFromDirectoryHandle(handle as FileSystemDirectoryHandle, relativePath)));
      continue;
    }
    if (!/\.log$/i.test(name)) continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    out.push({
      name,
      relativePath,
      text: await file.text(),
      sourceFile: file,
    });
  }
  return out;
}
