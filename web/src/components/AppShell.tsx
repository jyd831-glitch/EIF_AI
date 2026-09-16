"use client";

import { useState } from "react";
import TimeFloorApp from "@/components/TimeFloorApp";
import LogViewerApp from "@/components/LogViewerApp";

type TabId = "timefloor" | "logviewer";

export default function AppShell() {
  const [tab, setTab] = useState<TabId>("timefloor");

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
      </header>
      <div className="shell-body">
        {tab === "timefloor" ? <TimeFloorApp embedded /> : <LogViewerApp />}
      </div>
    </div>
  );
}
