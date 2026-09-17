"use client";

import { useEffect, useState } from "react";
import TimeFloorApp from "@/components/TimeFloorApp";
import LogViewerApp from "@/components/LogViewerApp";
import { fetchFileAccessMode, type FileAccessMode } from "@/lib/fileAccess";

type TabId = "timefloor" | "logviewer";

export default function AppShell() {
  const [tab, setTab] = useState<TabId>("timefloor");
  const [mode, setMode] = useState<FileAccessMode>("cloud");

  useEffect(() => {
    void fetchFileAccessMode().then((m) => setMode(m.mode));
  }, []);

  return (
    <div className="shell">
      <header className="shell-top">
        <div className="brand">
          <span className="brand-mark">EIF</span>
          <div>
            <h1>EIF Log Tools</h1>
            <p>타임플로어 · 로그뷰어</p>
          </div>
        </div>
        <nav className="shell-tabs" aria-label="화면 전환">
          <button
            type="button"
            className={tab === "timefloor" ? "active" : ""}
            onClick={() => setTab("timefloor")}
          >
            타임플로어
          </button>
          <button
            type="button"
            className={tab === "logviewer" ? "active" : ""}
            onClick={() => setTab("logviewer")}
          >
            로그뷰어
          </button>
        </nav>
        <span
          className={`mode-badge ${mode}`}
          title={
            mode === "local"
              ? "로컬: PC 디스크를 Next 서버가 직접 읽습니다"
              : "클라우드: 브라우저 폴더 선택 (Vercel)"
          }
        >
          {mode === "local" ? "LOCAL · 디스크 직접읽기" : "CLOUD · 폴더선택"}
        </span>
      </header>
      <div className="shell-body">
        {tab === "timefloor" ? <TimeFloorApp embedded /> : <LogViewerApp />}
      </div>
    </div>
  );
}
