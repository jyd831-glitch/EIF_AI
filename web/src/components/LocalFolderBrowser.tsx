"use client";

import { useCallback, useEffect, useState } from "react";

export type BrowseEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isSelectable: boolean;
  hasSfc?: boolean;
  hasSolace?: boolean;
  hasTrace?: boolean;
  hasLogFiles?: boolean;
  size?: number;
};

export type BrowseResult = {
  rootName: string;
  currentPath: string;
  parentPath: string | null;
  isComputerRoot: boolean;
  currentIsSelectable: boolean;
  breadcrumbs: string[];
  entries: BrowseEntry[];
};

type Props = {
  open: boolean;
  mode: "timefloor" | "logviewer";
  initialPath?: string | null;
  onClose: () => void;
  onSelect: (folderPath: string) => void;
};

export default function LocalFolderBrowser({ open, mode, initialPath, onClose, onSelect }: Props) {
  const [data, setData] = useState<BrowseResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const load = useCallback(
    async (path: string | null) => {
      setBusy(true);
      setError("");
      try {
        const q = new URLSearchParams();
        if (path != null) q.set("path", path);
        q.set("mode", mode);
        const res = await fetch(`/api/browse?${q}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "폴더 목록을 불러오지 못했습니다.");
        setData(json as BrowseResult);
        const cur = (json as BrowseResult).currentPath;
        if ((json as BrowseResult).currentIsSelectable) setSelectedPath(cur);
        else setSelectedPath(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setData(null);
      } finally {
        setBusy(false);
      }
    },
    [mode]
  );

  useEffect(() => {
    if (!open) return;
    void (async () => {
      if (initialPath) {
        await load(initialPath);
        return;
      }
      try {
        const res = await fetch("/api/browse/default", { cache: "no-store" });
        const json = await res.json();
        if (res.ok && json.path) await load(json.path as string);
        else await load(null);
      } catch {
        await load(null);
      }
    })();
  }, [open, initialPath, load]);

  if (!open) return null;

  function tags(e: BrowseEntry) {
    const parts: string[] = [];
    if (e.hasSfc) parts.push("SFC");
    if (e.hasSolace) parts.push("SOLACE");
    if (e.hasTrace) parts.push("TRACE");
    if (e.hasLogFiles && !parts.length) parts.push("LOG");
    return parts.join(" · ");
  }

  return (
    <div className="folder-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="folder-modal"
        role="dialog"
        aria-modal="true"
        aria-label="로컬 폴더 열기"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="folder-modal-head">
          <div>
            <h2>로컬 폴더 열기</h2>
            <p>PC 디스크에서 직접 읽습니다. (브라우저 업로드 아님)</p>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
        </header>

        <div className="folder-modal-toolbar">
          <button
            type="button"
            className="btn"
            disabled={busy || !!data?.isComputerRoot}
            onClick={() => {
              if (data?.isComputerRoot) return;
              if (data?.parentPath === "") void load(null);
              else if (data?.parentPath) void load(data.parentPath);
            }}
          >
            위로
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void load(null)}>
            이 PC
          </button>
          <div className="folder-modal-path" title={data?.currentPath || "이 PC"}>
            {data?.isComputerRoot ? "이 PC" : data?.currentPath || "…"}
          </div>
        </div>

        {error && <div className="folder-modal-error">{error}</div>}

        <div className="folder-modal-list">
          {busy && !data ? (
            <p className="muted">불러오는 중…</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>종류</th>
                </tr>
              </thead>
              <tbody>
                {(data?.entries || []).map((e) => (
                  <tr
                    key={e.path}
                    className={`${e.isDirectory ? "is-dir" : "is-file"}${
                      e.isSelectable ? " is-selectable" : ""
                    }${selectedPath === e.path ? " is-selected" : ""}`}
                    onClick={() => {
                      if (e.isDirectory && e.isSelectable) setSelectedPath(e.path);
                    }}
                    onDoubleClick={() => {
                      if (e.isDirectory) void load(e.path);
                    }}
                  >
                    <td>
                      <span className="folder-modal-name">{e.name}</span>
                    </td>
                    <td className="muted">{e.isDirectory ? tags(e) || "폴더" : "파일"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="folder-modal-foot">
          <div className="muted">
            {mode === "timefloor"
              ? "SFC / SOLACE / TRACE 가 있는 폴더(예: PLCTYPE)를 선택한 뒤 열기"
              : ".log 가 있는 폴더를 선택한 뒤 열기"}
          </div>
          <div className="folder-modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              취소
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={
                busy ||
                !(
                  selectedPath ||
                  (data && !data.isComputerRoot && data.currentIsSelectable && data.currentPath)
                )
              }
              onClick={() => {
                const target =
                  selectedPath ||
                  (data && !data.isComputerRoot && data.currentIsSelectable ? data.currentPath : null);
                if (!target) return;
                onSelect(target);
              }}
            >
              열기
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
