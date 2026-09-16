"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { LogFile } from "@/lib/types";
import {
  readFilesFromDirectoryHandle,
  readFilesFromInput,
  rereadLogFiles,
} from "@/lib/buildTimeFloor";
import {
  expandHitsToMessageBlocks,
  extractMessageBlocksInRange,
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

export default function LogViewerApp() {
  const fileRef = useRef<HTMLInputElement>(null);
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<LogFile[]>([]);
  const [folderLabel, setFolderLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileFilterDraft, setFileFilterDraft] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const [contentQuery, setContentQuery] = useState("");
  const [timeFrom, setTimeFrom] = useState("00:00");
  const [timeTo, setTimeTo] = useState("23:59");
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<string>("ALL");

  useEffect(() => {
    const el = fileRef.current;
    if (!el) return;
    el.setAttribute("webkitdirectory", "");
    el.setAttribute("directory", "");
    el.setAttribute("multiple", "");
  }, []);

  function runFileSearch() {
    const q = fileFilterDraft.trim();
    setFileFilter(q);
    setContentQuery(q); // 본문도 같은 키워드로 관련 메시지 블록 표시
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

  // 검색어가 바뀌면 관련도 1위 로그로 이동 (파일 클릭 선택은 유지되도록 selectedPath는 deps에서 제외)
  useEffect(() => {
    if (!fileFilter.trim()) return;
    if (searchEmpty) {
      setSelectedPath("");
      setError(`"${fileFilter}" 와 일치하는 로그가 없습니다.`);
      return;
    }
    setError("");
    startTransition(() => setSelectedPath(visibleFiles[0].relativePath));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-jump on new search/kind
  }, [fileFilter, kindFilter, searchEmpty]);

  const selected = useMemo(
    () => files.find((f) => f.relativePath === selectedPath) || null,
    [files, selectedPath]
  );

  const hasTimeWindow = !(timeFrom === "00:00" && timeTo === "23:59");

  const viewModel = useMemo(() => {
    if (!selected) return null;
    const text = selected.text.replace(/\r\n/g, "\n");
    const q = contentQuery.trim();
    const timeOpts = hasTimeWindow
      ? { date: "", timeFrom: timeFrom || "00:00", timeTo: timeTo || "23:59" }
      : undefined;

    if (q) {
      // Time filter applied while collecting so matches later in the file are not dropped.
      const expanded = expandHitsToMessageBlocks(text, q, Number.POSITIVE_INFINITY, timeOpts);
      return {
        mode: "filter" as const,
        blocks: expanded.blocks,
        truncated: expanded.truncated,
        totalLines: expanded.totalLines,
      };
    }

    if (hasTimeWindow) {
      const ranged = extractMessageBlocksInRange(
        text,
        "",
        timeFrom || "00:00",
        timeTo || "23:59"
      );
      return {
        mode: "filter" as const,
        blocks: ranged.blocks,
        truncated: ranged.truncated,
        totalLines: ranged.totalLines,
      };
    }

    return { mode: "raw" as const, text, bytes: text.length };
  }, [selected, contentQuery, timeFrom, timeTo, hasTimeWindow]);

  async function applyLoaded(loaded: LogFile[], labelRoot: string) {
    if (!loaded.length) throw new Error(".log 파일을 찾지 못했습니다.");
    setFiles(loaded);
    setFolderLabel(`${labelRoot} (${loaded.length} logs)`);
    setError("");
    const keep = loaded.find((f) => f.relativePath === selectedPath);
    setSelectedPath(keep ? keep.relativePath : loaded[0]?.relativePath || "");
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
        // Re-read previously selected files without opening Explorer
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
          {selected ? ` · ${selected.name}` : ""}
          {viewModel?.mode === "raw"
            ? ` · ${(viewModel.bytes / 1024).toFixed(viewModel.bytes >= 102400 ? 0 : 1)} KB`
            : ""}
          {viewModel?.mode === "filter"
            ? ` · ${viewModel.blocks.length.toLocaleString()} msg`
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
              onClick={() => {
                if (fileRef.current) {
                  fileRef.current.value = "";
                  fileRef.current.click();
                }
              }}
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
          <span>파일 / 내용 검색</span>
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
            <button type="button" className="btn primary" disabled={busy || !files.length} onClick={runFileSearch}>
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
              className={`log-file-item${selectedPath === f.relativePath ? " active" : ""}`}
              onClick={() => startTransition(() => setSelectedPath(f.relativePath))}
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
          </div>
        </div>
        <div className="log-view-body">
          {!selected || !viewModel ? (
            <div className="empty">왼쪽에서 로그 파일을 선택하세요.</div>
          ) : viewModel.mode === "raw" ? (
            <pre className="log-lines log-lines-raw">{viewModel.text}</pre>
          ) : viewModel.blocks.length === 0 ? (
            <pre className="log-lines">
              <span className="muted">
                {contentQuery.trim()
                  ? "검색어/시간 조건에 맞는 메시지가 없습니다."
                  : "선택한 시간 구간의 메시지가 없습니다."}
              </span>
            </pre>
          ) : (
            <div className="log-blocks">
              {/* Single pre keeps large time-window results scrollable and complete */}
              <pre className="log-lines log-lines-raw">
                {viewModel.blocks
                  .map((block) => block.lines.map((l) => l.text).join("\n"))
                  .join("\n\n")}
              </pre>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
