"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LogFile, SequenceMessage, TimeFloorResult } from "@/lib/types";
import {
  buildTimeFloor,
  collectLotIds,
  readFilesFromDirectoryHandle,
  readFilesFromInput,
  rereadLogFiles,
} from "@/lib/buildTimeFloor";
import { parseSfcLog } from "@/lib/parsers/sfc";
import { parseSolaceLog } from "@/lib/parsers/solace";
import { parseTraceLog } from "@/lib/parsers/trace";
import { isPcAscTrace, parsePcTraceLog } from "@/lib/parsers/pcTrace";

const ACTOR_X = { Mes: 0, Eif: 1, Plc: 2 } as const;

function fmtTime(d?: Date) {
  if (!d) return "-";
  return d.toLocaleTimeString("ko-KR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);
}

function fmtDateTime(d?: Date) {
  if (!d) return "-";
  return d.toLocaleString("ko-KR", { hour12: false });
}

function prettyRaw(raw?: string) {
  if (!raw) return "";
  const text = raw.replace(/\r\n/g, "\n").trim();
  const sep = text.match(/\s:\s(?=[{\[<])/);
  let body = text;
  let header = "";
  if (sep?.index != null) {
    header = text.slice(0, sep.index).trimEnd();
    body = text.slice(sep.index + sep[0].length).trim();
  }
  try {
    if ((body.startsWith("{") && body.endsWith("}")) || (body.startsWith("[") && body.endsWith("]"))) {
      const formatted = JSON.stringify(JSON.parse(body), null, 2);
      return header ? `${header}\n${formatted}` : formatted;
    }
  } catch {
    /* keep raw */
  }
  return text;
}

function pathHasKind(path: string, kind: "SFC" | "SOLACE" | "TRACE") {
  // webkit: PLCTYPE/SFC/a.log  |  directory picker: SFC/a.log
  return path.split("/").some((seg) => seg === kind);
}

function collectEventsFromFiles(loaded: LogFile[]) {
  const events = [];
  for (const f of loaded) {
    const p = f.relativePath.replace(/\\/g, "/").toUpperCase();
    if (pathHasKind(p, "SFC")) events.push(...parseSfcLog(f.text, f.name));
    else if (pathHasKind(p, "SOLACE")) events.push(...parseSolaceLog(f.text, f.name));
    else if (pathHasKind(p, "TRACE")) {
      if (isPcAscTrace(f.text)) events.push(...parsePcTraceLog(f.text, f.name));
      else events.push(...parseTraceLog(f.text, f.name, true));
    }
  }
  return events;
}

export default function TimeFloorApp({ embedded = false }: { embedded?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<LogFile[]>([]);
  const [folderLabel, setFolderLabel] = useState("");
  const [lotId, setLotId] = useState("");
  const [includeBitOff, setIncludeBitOff] = useState(true);
  const [lotIds, setLotIds] = useState<string[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TimeFloorResult | null>(null);
  const [selected, setSelected] = useState<SequenceMessage | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    const el = fileRef.current;
    if (!el) return;
    el.setAttribute("webkitdirectory", "");
    el.setAttribute("directory", "");
    el.setAttribute("multiple", "");
  }, []);

  const filteredLots = useMemo(() => {
    const q = lotId.trim().toLowerCase();
    if (!q) return lotIds.slice(0, 80);
    return lotIds.filter((x) => x.toLowerCase().includes(q)).slice(0, 80);
  }, [lotId, lotIds]);

  async function applyLoadedFiles(
    loaded: LogFile[],
    labelRoot: string,
    options: { preserveLot: boolean }
  ) {
    if (!loaded.length) throw new Error(".log 파일을 찾지 못했습니다.");
    setFiles(loaded);
    setFolderLabel(`${labelRoot} (${loaded.length} logs)`);

    const events = collectEventsFromFiles(loaded);
    setLotIds(collectLotIds(events));
    setSelected(null);
    setDetailOpen(false);

    const previousLot = options.preserveLot ? lotId.trim() : "";
    if (options.preserveLot && previousLot) {
      setLotId(previousLot);
      const built = buildTimeFloor(loaded, previousLot, includeBitOff);
      setResult(built);
      if (built.lotIds.length) setLotIds(built.lotIds);
      if (!built.messages.length) setError(`LOTID "${previousLot}" 에 해당하는 시퀀스가 없습니다.`);
      else setError("");
    } else {
      setLotId("");
      setResult(null);
      setError("");
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
      await applyLoadedFiles(loaded, top, { preserveLot: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function refreshFolder() {
    if (!files.length && !dirHandleRef.current) {
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

      await applyLoadedFiles(loaded, labelRoot, { preserveLot: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function runBuild() {
    if (!files.length) {
      setError("로그 폴더를 먼저 선택하세요.");
      return;
    }
    if (!lotId.trim()) {
      setError("LOT ID를 입력하세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const built = buildTimeFloor(files, lotId.trim(), includeBitOff);
      setResult(built);
      setLotIds(built.lotIds.length ? built.lotIds : lotIds);
      setSelected(null);
      setDetailOpen(false);
      if (!built.messages.length) setError(`LOTID "${lotId}" 에 해당하는 시퀀스가 없습니다.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const messages = result?.messages ?? [];

  return (
    <div className={`app${detailOpen ? " detail-open" : ""}`}>
      <header className={`topbar${embedded ? " compact" : ""}`}>
        {embedded ? (
          <div className="top-meta">
            {result
              ? `타임플로어 · ${result.logType} · LOT ${result.lotId} · ${messages.length} messages`
              : "타임플로어 · 로그 폴더와 LOTID를 선택하세요"}
          </div>
        ) : (
          <>
            <div className="brand">
              <span className="brand-mark">EIF</span>
              <div>
                <h1>TimeFloor Viewer</h1>
                <p>MES · EIF · PLC sequence diagram (Vercel)</p>
              </div>
            </div>
            <div className="top-meta">
              {result
                ? `${result.logType} · LOT ${result.lotId} · ${messages.length} messages`
                : "로그 폴더와 LOTID를 선택하세요"}
            </div>
          </>
        )}
      </header>

      <aside className="sidebar">
        <div className="field">
          <span>로그 폴더</span>
          <div className="folder-picker">
            <input readOnly value={folderLabel} placeholder="폴더 선택 (SFC/SOLACE/TRACE 포함)" />
            <label
              htmlFor="timefloor-folder-input"
              className={`btn${busy ? " is-disabled" : ""}`}
              aria-disabled={busy}
              onClick={(e) => {
                if (busy) {
                  e.preventDefault();
                  return;
                }
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              찾아보기...
            </label>
            <button
              type="button"
              className="btn"
              disabled={busy || !files.length}
              title="이전에 선택한 폴더를 다시 읽습니다"
              onClick={() => void refreshFolder()}
            >
              새로고침
            </button>
            <input
              id="timefloor-folder-input"
              ref={fileRef}
              className="folder-file-input"
              type="file"
              multiple
              onChange={(e) => void onPickFolder(e.target.files)}
            />
          </div>
        </div>

        <label className="field lot-field">
          <span>LOT ID</span>
          <div className="lot-combo">
            <input
              value={lotId}
              onChange={(e) => setLotId(e.target.value)}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runBuild();
              }}
              placeholder="예: HZFG300200"
              autoComplete="off"
              spellCheck={false}
            />
            {suggestOpen && filteredLots.length > 0 && (
              <ul className="lot-suggest">
                {filteredLots.map((lot) => (
                  <li
                    key={lot}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setLotId(lot);
                      setSuggestOpen(false);
                    }}
                  >
                    {lot}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </label>

        <label className="check">
          <input type="checkbox" checked={includeBitOff} onChange={(e) => setIncludeBitOff(e.target.checked)} />
          <span>BIT OFF 포함</span>
        </label>

        <button className="btn primary" type="button" disabled={busy} onClick={runBuild}>
          {busy ? "작성 중…" : "타임플로어 작성"}
        </button>

        <div className="stats">
          {error ? (
            error
          ) : result ? (
            <>
              folder: {result.logType}
              <br />
              LOT: {result.lotId}
              <br />
              messages: {messages.length}
              <br />
              events: {result.totalEvents}
              <br />
              range: {fmtDateTime(result.startTime)}
            </>
          ) : (
            "브라우저에서 로그 폴더를 선택합니다. (서버 업로드 없음)"
          )}
        </div>

        <div className="legend">
          <div>
            <i className="dot mes" /> MES
          </div>
          <div>
            <i className="dot eif" /> EIF
          </div>
          <div>
            <i className="dot plc" /> PLC
          </div>
        </div>
      </aside>

      <main className="stage">
        <div className="diagram-wrap">
          {!messages.length ? (
            <div className="empty">
              <b>찾아보기...</b>로 SFCTYPE / PCTYPE / PLCTYPE 폴더를 선택한 뒤 LOTID를 입력하세요.
            </div>
          ) : (
            <SequenceView
              messages={messages}
              onSelect={(msg) => {
                setSelected(msg);
                setDetailOpen(true);
              }}
              selectedId={selected?.id}
            />
          )}
        </div>
      </main>

      <section className="detail" hidden={!detailOpen}>
        <header>
          <h2>메시지 상세</h2>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setDetailOpen(false);
              setSelected(null);
            }}
          >
            닫기
          </button>
        </header>
        <div className="detail-body">
          {!selected ? (
            <p className="muted">메시지 NAME을 클릭하면 상세 내용이 표시됩니다.</p>
          ) : (
            <DetailBody msg={selected} />
          )}
        </div>
      </section>
    </div>
  );
}

function SequenceView({
  messages,
  onSelect,
  selectedId,
}: {
  messages: SequenceMessage[];
  onSelect: (m: SequenceMessage) => void;
  selectedId?: string;
}) {
  const width = 840;
  const padX = 70;
  const colGap = (width - padX * 2) / 2;
  const xs = [padX, padX + colGap, padX + colGap * 2];
  const rowH = 62;
  const top = 6;
  const height = Math.max(top + messages.length * rowH + 36, 80);

  return (
    <div className="seq">
      <div className="seq-sticky">
        <div className="seq-heads">
          <div className="actor mes" style={{ left: `${(xs[0] / width) * 100}%` }}>
            MES
          </div>
          <div className="actor eif" style={{ left: `${(xs[1] / width) * 100}%` }}>
            EIF
          </div>
          <div className="actor plc" style={{ left: `${(xs[2] / width) * 100}%` }}>
            PLC
          </div>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="xMidYMin meet">
        <defs>
          <marker id="arrowHead" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="#2f6fdb" />
          </marker>
          <marker id="arrowHeadAlarm" markerWidth="10" markerHeight="10" refX="8" refY="3.5" orient="auto">
            <path d="M0,0 L8,3.5 L0,7 Z" fill="#d32f2f" />
          </marker>
        </defs>
        {xs.map((x, i) => (
          <g key={i}>
            <line x1={x} x2={x} y1={0} y2={height - 14} stroke="#222" strokeWidth={1.4} />
            <polygon points={`${x - 5},${height - 24} ${x + 5},${height - 24} ${x},${height - 14}`} fill="#222" />
          </g>
        ))}
        {messages.map((msg, idx) => {
          const y = top + idx * rowH + 22;
          const x1 = xs[ACTOR_X[msg.from]];
          const x2 = xs[ACTOR_X[msg.to]];
          const midX = (x1 + x2) / 2;
          const alarm = !!msg.isAlarm;
          const active = selectedId === msg.id;
          return (
            <g
              key={msg.id}
              className={`msg-hit${alarm ? " alarm" : ""}${active ? " active" : ""}`}
              onClick={() => onSelect(msg)}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={Math.min(x1, x2) - 8}
                y={y - 28}
                width={Math.abs(x2 - x1) + 16}
                height={56}
                fill="transparent"
              />
              <text
                x={midX}
                y={y - 10}
                textAnchor="middle"
                fontSize={alarm ? 14 : 13}
                fontFamily="IBM Plex Sans, Segoe UI, sans-serif"
                fontWeight={alarm || active ? 700 : 400}
                fill={alarm ? "#c62828" : active ? "#d35400" : "#1c2430"}
              >
                {msg.label}
              </text>
              <line
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke={alarm ? "#d32f2f" : active ? "#d35400" : "#2f6fdb"}
                strokeWidth={alarm ? 3.2 : 1.8}
                markerEnd={alarm ? "url(#arrowHeadAlarm)" : "url(#arrowHead)"}
              />
              {msg.subLabel && (
                <text
                  x={midX}
                  y={y + 16}
                  textAnchor="middle"
                  fontSize={11}
                  fontFamily="IBM Plex Mono, monospace"
                  fill="#5f6e7f"
                >
                  {msg.subLabel}
                </text>
              )}
              <text x={8} y={y + 4} fontSize={10} fontFamily="IBM Plex Mono, monospace" fill="#8a97a6">
                {fmtTime(msg.timestamp)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function FieldPairs({ entries, empty }: { entries: [string, string][]; empty: string }) {
  if (!entries.length) return <div className="muted">{empty}</div>;
  return (
    <>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <div>{k}</div>
          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{v}</div>
        </div>
      ))}
    </>
  );
}

function DetailBody({ msg }: { msg: SequenceMessage }) {
  const isTrace = msg.source === "Trace";
  const bitEntries = Object.entries(msg.fields || {});
  const wordEntries = Object.entries(msg.wordFields || {});
  const hasWord = wordEntries.length > 0 || !!msg.wordRawSnippet;
  const raw = prettyRaw(msg.rawSnippet);
  const wordRaw = prettyRaw(msg.wordRawSnippet);

  return (
    <div>
      <div className="kv">
        <div>Time</div>
        <div>{fmtDateTime(msg.timestamp)}</div>
        <div>From</div>
        <div>
          {msg.from.toUpperCase()} → {msg.to.toUpperCase()}
        </div>
        <div>Label</div>
        <div>{msg.label || ""}</div>
        <div>Sub</div>
        <div>{msg.subLabel || "-"}</div>
        <div>Signal</div>
        <div>{msg.signal || "-"}</div>
        <div>Value</div>
        <div>{msg.value || "-"}</div>
        <div>LOTID</div>
        <div>{msg.lotId || "-"}</div>
        <div>POSITION</div>
        <div>{msg.position || "-"}</div>
        <div>Alarm</div>
        <div>{msg.isAlarm ? "YES" : "no"}</div>
      </div>

      <h3 className="detail-section-title">{isTrace ? "Bit Fields" : "Fields"}</h3>
      <div className="kv">
        <FieldPairs entries={bitEntries} empty="없음" />
      </div>

      <h3 className="detail-section-title">{isTrace ? "Bit Raw" : "Message Raw"}</h3>
      {raw ? <pre className="raw">{raw}</pre> : <p className="muted">없음</p>}

      {isTrace &&
        (hasWord ? (
          <>
            <h3 className="detail-section-title">Word Data</h3>
            <div className="kv">
              <div>Signal</div>
              <div>{msg.wordSignal || "-"}</div>
              <div>Time</div>
              <div>{fmtDateTime(msg.wordTimestamp)}</div>
            </div>
            <div className="kv" style={{ marginTop: "0.5rem" }}>
              <FieldPairs entries={wordEntries} empty="필드 없음" />
            </div>
            {wordRaw ? (
              <div className="raw-wrap" style={{ marginTop: "0.5rem" }}>
                <pre className="raw">{wordRaw}</pre>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <h3 className="detail-section-title">Word Data</h3>
            <p className="muted">매칭되는 Word 데이터 없음</p>
          </>
        ))}
    </div>
  );
}
