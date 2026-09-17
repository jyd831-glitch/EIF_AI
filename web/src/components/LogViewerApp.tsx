"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { LogFile } from "@/lib/types";
import {
  directoryPickerBlockedReason,
  pickDirectoryHandle,
  readFilesFromDirectoryHandle,
  readFilesFromInput,
  rereadLogFiles,
} from "@/lib/buildTimeFloor";
import {
  dateFromFileName,
  expandHitsToMessageBlocks,
  extractMessageBlocksInRange,
  guessLogDate,
  type MessageBlock,
} from "@/lib/logBlocks";

function kindFromPath(path: string): string {
  const p = path.replace(/\\/g, "/").toUpperCase();
  const parts = p.split("/");
  for (const kind of ["SFC", "SOLACE", "TRACE"]) {
    if (parts.includes(kind)) return kind;
  }
  const ext = path.split(".").pop()?.toUpperCase();
  return ext || "LOG";
}

function countMatchingLines(text: string, q: string): number {
  if (!q) return 0;
  const ql = q.toLowerCase();
  let hits = 0;
  let start = 0;
  const src = text.replace(/\r\n/g, "\n");
  while (start <= src.length) {
    let end = src.indexOf("\n", start);
    if (end < 0) end = src.length;
    if (src.slice(start, end).toLowerCase().includes(ql)) hits++;
    if (end >= src.length) break;
    start = end + 1;
  }
  return hits;
}

function rankLogFile(f: LogFile, q: string) {
  const ql = q.toLowerCase();
  const nameHit = f.name.toLowerCase().includes(ql);
  const pathHit = f.relativePath.toLowerCase().includes(ql);
  const lineHits = countMatchingLines(f.text, ql);
  const score = (nameHit ? 10_000 : 0) + (pathHit ? 1_000 : 0) + lineHits;
  return { file: f, score, lineHits, nameHit, pathHit };
}

function blocksToText(blocks: { lines: { text: string }[] }[]): string {
  return blocks.map((b) => b.lines.map((l) => l.text).join("\n")).join("\n\n");
}

type FileMessageHit = {
  path: string;
  block: MessageBlock;
};

/** Search every log in the folder for messages in date/time (and optional keyword). */
function searchAllFilesInRange(
  allFiles: LogFile[],
  date: string,
  timeFrom: string,
  timeTo: string,
  query: string
): { hits: FileMessageHit[]; matchedFiles: number; scannedFiles: number } {
  const q = query.trim();
  const hits: FileMessageHit[] = [];
  let matchedFiles = 0;

  for (const f of allFiles) {
    const text = f.text.replace(/\r\n/g, "\n");
    const blocks = q
      ? expandHitsToMessageBlocks(text, q, Number.POSITIVE_INFINITY, {
          date,
          timeFrom,
          timeTo,
        }).blocks
      : extractMessageBlocksInRange(text, date, timeFrom, timeTo).blocks;

    if (!blocks.length) continue;
    matchedFiles++;
    for (const block of blocks) {
      hits.push({ path: f.relativePath, block });
    }
  }

  hits.sort((a, b) => {
    const ta = a.block.timestamp?.getTime() ?? 0;
    const tb = b.block.timestamp?.getTime() ?? 0;
    return ta - tb || a.path.localeCompare(b.path) || a.block.start - b.block.start;
  });

  return { hits, matchedFiles, scannedFiles: allFiles.length };
}

function fileHitsToText(hits: FileMessageHit[]): string {
  const parts: string[] = [];
  let lastPath = "";
  for (const hit of hits) {
    if (hit.path !== lastPath) {
      if (parts.length) parts.push("");
      parts.push(`========== ${hit.path} ==========`);
      parts.push("");
      lastPath = hit.path;
    }
    parts.push(hit.block.lines.map((l) => l.text).join("\n"));
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

export default function LogViewerApp() {
  const fileRef = useRef<HTMLInputElement>(null);
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<LogFile[]>([]);
  const [folderLabel, setFolderLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Sidebar: file list + whole-file content search
  const [fileFilterDraft, setFileFilterDraft] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const [fullContentQuery, setFullContentQuery] = useState("");

  // Toolbar: date + time window + content search within that window
  const [filterDate, setFilterDate] = useState("");
  const [timeFrom, setTimeFrom] = useState("00:00");
  const [timeTo, setTimeTo] = useState("23:59");
  const [timeContentDraft, setTimeContentDraft] = useState("");
  const [timeContentQuery, setTimeContentQuery] = useState("");
  const [timeSearchActive, setTimeSearchActive] = useState(false);

  const [selectedPath, setSelectedPath] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<string>("ALL");

  useEffect(() => {
    const el = fileRef.current;
    if (!el) return;
    el.setAttribute("webkitdirectory", "");
    el.setAttribute("directory", "");
    el.setAttribute("multiple", "");
  }, []);

  /** Sidebar search: whole log file (no time filter). */
  function runFileSearch() {
    const q = fileFilterDraft.trim();
    setFileFilter(q);
    setFullContentQuery(q);
    setTimeSearchActive(false);
    setTimeContentQuery("");
  }

  /** Toolbar search: scan every file in the folder for the date/time window. */
  function runTimeSearch() {
    setTimeContentQuery(timeContentDraft.trim());
    setTimeSearchActive(true);
    setFullContentQuery("");
  }

  function selectFile(path: string) {
    setTimeSearchActive(false);
    startTransition(() => setSelectedPath(path));
  }

  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const f of files) set.add(kindFromPath(f.relativePath));
    return ["ALL", ...[...set].sort()];
  }, [files]);

  const { visibleFiles, matchMeta, searchEmpty } = useMemo(() => {
    const q = fileFilter.trim();
    const base = files.filter(
      (f) => kindFilter === "ALL" || kindFromPath(f.relativePath) === kindFilter
    );

    if (!q) {
      return {
        visibleFiles: [...base].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
        matchMeta: {} as Record<string, number>,
        searchEmpty: false,
      };
    }

    const ranked = base
      .map((f) => rankLogFile(f, q))
      .filter((r) => r.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.file.relativePath.localeCompare(b.file.relativePath)
      );

    const meta: Record<string, number> = {};
    for (const r of ranked) meta[r.file.relativePath] = r.lineHits;

    return {
      visibleFiles: ranked.map((r) => r.file),
      matchMeta: meta,
      searchEmpty: ranked.length === 0,
    };
  }, [files, fileFilter, kindFilter]);

  useEffect(() => {
    if (!fileFilter.trim()) return;
    if (searchEmpty) {
      setSelectedPath("");
      setError(`"${fileFilter}" 와 일치하는 로그가 없습니다.`);
      return;
    }
    setError("");
    setTimeSearchActive(false);
    startTransition(() => setSelectedPath(visibleFiles[0].relativePath));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-jump on new search/kind
  }, [fileFilter, kindFilter, searchEmpty]);

  const selected = useMemo(
    () => files.find((f) => f.relativePath === selectedPath) || null,
    [files, selectedPath]
  );

  const viewModel = useMemo(() => {
    const date = filterDate.trim();
    const from = timeFrom || "00:00";
    const to = timeTo || "23:59";

    // Date/time search across the entire folder
    if (timeSearchActive) {
      if (!files.length) return null;
      const q = timeContentQuery.trim();
      const { hits, matchedFiles, scannedFiles } = searchAllFilesInRange(
        files,
        date,
        from,
        to,
        q
      );
      return {
        mode: "filter" as const,
        source: "time" as const,
        blocks: hits.map((h) => h.block),
        text: fileHitsToText(hits),
        totalLines: 0,
        matchedFiles,
        scannedFiles,
      };
    }

    if (!selected) return null;
    const text = selected.text.replace(/\r\n/g, "\n");

    // Sidebar search: entire selected file
    const fullQ = fullContentQuery.trim();
    if (fullQ) {
      const expanded = expandHitsToMessageBlocks(text, fullQ);
      return {
        mode: "filter" as const,
        source: "full" as const,
        blocks: expanded.blocks,
        text: blocksToText(expanded.blocks),
        totalLines: expanded.totalLines,
        matchedFiles: 1,
        scannedFiles: 1,
      };
    }

    return { mode: "raw" as const, text, bytes: text.length };
  }, [
    selected,
    files,
    fullContentQuery,
    timeSearchActive,
    timeContentQuery,
    filterDate,
    timeFrom,
    timeTo,
  ]);

  async function applyLoaded(loaded: LogFile[], labelRoot: string) {
    if (!loaded.length) throw new Error(".log 파일을 찾지 못했습니다.");
    setFiles(loaded);
    setFolderLabel(`${labelRoot} (${loaded.length} logs)`);
    setError("");
    const keep = loaded.find((f) => f.relativePath === selectedPath);
    const next = keep || loaded[0];
    setSelectedPath(next?.relativePath || "");

    // Prefer date from selected/first log so multi-day folders start filtered usefully
    if (!filterDate.trim() && next) {
      const d =
        dateFromFileName(next.name) ||
        dateFromFileName(next.relativePath) ||
        guessLogDate(next.text);
      if (d) setFilterDate(d);
    }
  }

  async function browseFolder() {
    if (busy) return;

    const blocked = directoryPickerBlockedReason();
    if (blocked) {
      setError(blocked);
      return;
    }

    setBusy(true);
    setError("");
    try {
      const handle = await pickDirectoryHandle();
      if (!handle) return;
      dirHandleRef.current = handle;
      const loaded = await readFilesFromDirectoryHandle(handle);
      await applyLoaded(loaded, handle.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onPickFolder(list: FileList | null) {
    if (!list?.length) return;
    dirHandleRef.current = null;
    setBusy(true);
    setError("");
    try {
      const loaded = await readFilesFromInput(list);
      const top =
        (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split(/[\\/]/)[0] ||
        "선택됨";
      await applyLoaded(loaded, top);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function refreshFolder() {
    if (!files.length) {
      setError("로그 폴더를 먼저 선택하세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let loaded: LogFile[] = [];
      let labelRoot = folderLabel.split(" (")[0] || "선택됨";

      if (dirHandleRef.current) {
        const handle = dirHandleRef.current as FileSystemDirectoryHandle & {
          queryPermission: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
          requestPermission: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
        };
        let status = await handle.queryPermission({ mode: "read" });
        if (status !== "granted") status = await handle.requestPermission({ mode: "read" });
        if (status !== "granted") {
          throw new Error("폴더 읽기 권한이 없습니다. 찾아보기로 다시 선택하세요.");
        }
        loaded = await readFilesFromDirectoryHandle(handle);
        labelRoot = handle.name;
      } else {
        loaded = await rereadLogFiles(files);
        if (!loaded.length) {
          throw new Error("다시 읽을 파일이 없습니다. 찾아보기로 폴더를 다시 선택하세요.");
        }
      }

      await applyLoaded(loaded, labelRoot);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app log-viewer">
      <header className="topbar compact">
        <div className="top-meta">
          {folderLabel ? `로그뷰어 · ${folderLabel}` : "로그 폴더를 선택하세요"}
          {timeSearchActive
            ? ""
            : selected
              ? ` · ${selected.name}`
              : ""}
          {viewModel?.mode === "raw"
            ? ` · ${(viewModel.bytes / 1024).toFixed(viewModel.bytes >= 102400 ? 0 : 1)} KB`
            : ""}
          {viewModel?.mode === "filter"
            ? ` · ${viewModel.blocks.length.toLocaleString()} msg${
                viewModel.source === "time"
                  ? ` · 폴더검색 ${viewModel.matchedFiles}/${viewModel.scannedFiles} files`
                  : " · 전체검색"
              }`
            : ""}
        </div>
      </header>

      <aside className="sidebar">
        <div className="field">
          <span>로그 폴더</span>
          <div className="folder-picker">
            <input readOnly value={folderLabel} placeholder="임의의 .log 폴더 선택" />
            <button
              type="button"
              className="btn"
              disabled={busy}
              title="로컬 폴더 열기 (읽기 전용)"
              onClick={() => void browseFolder()}
            >
              찾아보기...
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !files.length}
              title="이전에 선택한 폴더를 다시 읽습니다 (탐색기 없음)"
              onClick={() => void refreshFolder()}
            >
              새로고침
            </button>
            <input
              id="log-viewer-folder-input"
              ref={fileRef}
              className="folder-file-input"
              type="file"
              multiple
              onChange={(e) => void onPickFolder(e.target.files)}
            />
          </div>
        </div>

        <div className="field">
          <span>파일 / 내용 검색 (전체)</span>
          <div className="search-row">
            <input
              value={fileFilterDraft}
              onChange={(e) => setFileFilterDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runFileSearch();
              }}
              placeholder="파일명 또는 내용 키워드"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="btn primary"
              disabled={busy || !files.length}
              onClick={runFileSearch}
            >
              검색
            </button>
          </div>
        </div>

        <label className="field">
          <span>종류</span>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>

        <div className="file-count">
          {error
            ? error
            : files.length
              ? `${visibleFiles.length}/${files.length} files`
              : "폴더를 선택하세요"}
        </div>

        <div className="log-file-list">
          {visibleFiles.map((f) => (
            <button
              key={f.relativePath}
              type="button"
              className={`log-file-item${
                !timeSearchActive && selectedPath === f.relativePath ? " active" : ""
              }`}
              onClick={() => selectFile(f.relativePath)}
              title={f.relativePath}
            >
              <span className="log-file-kind">{kindFromPath(f.relativePath)}</span>
              <span className="log-file-name">{f.name}</span>
              <span className="log-file-path">
                {matchMeta[f.relativePath] != null
                  ? `${f.relativePath} · ${matchMeta[f.relativePath]} hits`
                  : f.relativePath}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="stage">
        <div className="log-view-toolbar">
          <div className="time-filter-row">
            <label className="field inline">
              <span>날짜</span>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              />
            </label>
            <label className="field inline">
              <span>시간</span>
              <input
                type="time"
                step={60}
                value={timeFrom}
                onChange={(e) => setTimeFrom(e.target.value)}
              />
            </label>
            <span className="time-sep">~</span>
            <label className="field inline">
              <span className="sr-only">종료 시간</span>
              <input
                type="time"
                step={60}
                value={timeTo}
                onChange={(e) => setTimeTo(e.target.value)}
              />
            </label>

            <label className="field inline time-content-search">
              <span>내용 검색</span>
              <input
                value={timeContentDraft}
                onChange={(e) => setTimeContentDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runTimeSearch();
                }}
                placeholder="폴더 전체 · 날짜·시간 키워드"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !files.length}
              onClick={runTimeSearch}
              title="폴더 전체 파일을 날짜·시간으로 검색"
            >
              검색
            </button>
          </div>
        </div>
        <div className="log-view-body">
          {!viewModel ? (
            <div className="empty">
              {files.length
                ? "날짜·시간을 설정한 뒤 검색하거나, 왼쪽에서 로그 파일을 선택하세요."
                : "왼쪽에서 로그 폴더를 선택하세요."}
            </div>
          ) : viewModel.mode === "raw" ? (
            <pre className="log-lines log-lines-raw">{viewModel.text}</pre>
          ) : viewModel.blocks.length === 0 ? (
            <pre className="log-lines">
              <span className="muted">
                {viewModel.source === "time"
                  ? timeContentQuery.trim()
                    ? `폴더 ${viewModel.scannedFiles}개 파일에서 해당 날짜·시간대·검색어와 일치하는 메시지가 없습니다.`
                    : `폴더 ${viewModel.scannedFiles}개 파일에서 선택한 날짜·시간 구간의 메시지가 없습니다.`
                  : "검색어와 일치하는 메시지가 없습니다."}
              </span>
            </pre>
          ) : (
            <div className="log-blocks">
              <pre className="log-lines log-lines-raw">{viewModel.text}</pre>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
