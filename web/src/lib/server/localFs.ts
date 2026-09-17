import fs from "fs";
import os from "os";
import path from "path";

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

/** Local disk browse/load is only for non-Vercel (PC) runs. */
export function isLocalFsEnabled(): boolean {
  if (process.env.VERCEL) return false;
  if (process.env.LOCAL_FS_ENABLED === "0") return false;
  return true;
}

export function assertLocalFs() {
  if (!isLocalFsEnabled()) {
    throw new Error("로컬 디스크 접근은 PC에서 실행할 때만 가능합니다. (Vercel 클라우드에서는 폴더 선택을 사용하세요)");
  }
}

function isLogTypeFolder(dir: string): boolean {
  try {
    return (
      fs.existsSync(path.join(dir, "SFC")) ||
      fs.existsSync(path.join(dir, "SOLACE")) ||
      fs.existsSync(path.join(dir, "TRACE"))
    );
  } catch {
    return false;
  }
}

function dirHasLogFiles(dir: string, depth = 0): boolean {
  if (depth > 3) return false;
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isFile() && /\.log$/i.test(name)) return true;
      if (st.isDirectory() && dirHasLogFiles(full, depth + 1)) return true;
    }
  } catch {
    /* skip */
  }
  return false;
}

export function resolveDefaultRoot(): string {
  const candidates = [
    process.env.LOG_ROOT,
    path.resolve(process.cwd(), "..", "LOG"),
    path.resolve(process.cwd(), "LOG"),
    path.join(os.homedir(), "Desktop", "EIF_AI", "LOG"),
    path.join(os.homedir(), "OneDrive", "Desktop", "EIF_AI", "LOG"),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return path.resolve(c);
    } catch {
      /* skip */
    }
  }
  return path.resolve(candidates[0] || os.homedir());
}

function listDrives(): BrowseEntry[] {
  const entries: BrowseEntry[] = [];
  if (process.platform === "win32") {
    for (let i = 65; i <= 90; i++) {
      const letter = String.fromCharCode(i);
      const root = `${letter}:\\`;
      try {
        if (!fs.existsSync(root)) continue;
        entries.push({
          name: `${letter}:`,
          path: root,
          isDirectory: true,
          isSelectable: false,
        });
      } catch {
        /* skip */
      }
    }
  } else {
    entries.push({
      name: "/",
      path: "/",
      isDirectory: true,
      isSelectable: false,
    });
  }
  return entries;
}

export type BrowseMode = "timefloor" | "logviewer";

export function browseFolder(rawPath: string | null | undefined, mode: BrowseMode): BrowseResult {
  assertLocalFs();

  if (!rawPath || rawPath === "." || rawPath === "\\" || rawPath === "/") {
    if (process.platform === "win32" && (!rawPath || rawPath === "." || rawPath === "\\")) {
      return {
        rootName: "이 PC",
        currentPath: "",
        parentPath: null,
        isComputerRoot: true,
        currentIsSelectable: false,
        breadcrumbs: ["이 PC"],
        entries: listDrives(),
      };
    }
  }

  const currentFull = path.resolve(rawPath || resolveDefaultRoot());
  if (!fs.existsSync(currentFull) || !fs.statSync(currentFull).isDirectory()) {
    throw new Error(`폴더를 찾을 수 없습니다: ${currentFull}`);
  }

  const parent = path.dirname(currentFull);
  const parentPath =
    process.platform === "win32" && /^[a-zA-Z]:\\?$/.test(currentFull.replace(/\//g, "\\"))
      ? ""
      : parent === currentFull
        ? null
        : parent;

  const entries: BrowseEntry[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(currentFull);
  } catch (e) {
    throw new Error(`접근 거부: ${e instanceof Error ? e.message : String(e)}`);
  }

  const dirs: string[] = [];
  const files: string[] = [];
  for (const name of names) {
    const full = path.join(currentFull, name);
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) dirs.push(name);
      else files.push(name);
    } catch {
      /* skip */
    }
  }

  dirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  for (const name of dirs) {
    const full = path.join(currentFull, name);
    const hasSfc = fs.existsSync(path.join(full, "SFC"));
    const hasSolace = fs.existsSync(path.join(full, "SOLACE"));
    const hasTrace = fs.existsSync(path.join(full, "TRACE"));
    const hasType = hasSfc || hasSolace || hasTrace;
    const hasLogFiles = mode === "logviewer" ? dirHasLogFiles(full) : false;
    entries.push({
      name,
      path: full,
      isDirectory: true,
      isSelectable: mode === "timefloor" ? hasType : hasType || hasLogFiles,
      hasSfc,
      hasSolace,
      hasTrace,
      hasLogFiles,
    });
  }

  for (const name of files) {
    const full = path.join(currentFull, name);
    try {
      entries.push({
        name,
        path: full,
        isDirectory: false,
        isSelectable: false,
        size: fs.statSync(full).size,
      });
    } catch {
      /* skip */
    }
  }

  const crumbs = currentFull
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean);

  const currentIsSelectable =
    mode === "timefloor" ? isLogTypeFolder(currentFull) : isLogTypeFolder(currentFull) || dirHasLogFiles(currentFull);

  return {
    rootName: "이 PC",
    currentPath: currentFull,
    parentPath: parentPath === "" ? "" : parentPath,
    isComputerRoot: false,
    currentIsSelectable,
    breadcrumbs: crumbs,
    entries,
  };
}

export type LoadedLogFile = {
  name: string;
  relativePath: string;
  text: string;
};

const MAX_FILE_BYTES = 48 * 1024 * 1024;

function walkLogs(dir: string, base: string, out: LoadedLogFile[]) {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    const rel = base ? `${base}/${name}` : name;
    if (st.isDirectory()) {
      walkLogs(full, rel, out);
      continue;
    }
    if (!/\.log$/i.test(name)) continue;
    if (st.size > MAX_FILE_BYTES) {
      throw new Error(`파일이 너무 큽니다 (${name}, ${(st.size / 1024 / 1024).toFixed(1)}MB). 48MB 이하만 지원합니다.`);
    }
    out.push({
      name,
      relativePath: rel.replace(/\\/g, "/"),
      text: fs.readFileSync(full, "utf8"),
    });
  }
}

export function loadLogFolder(folderPath: string): { folder: string; files: LoadedLogFile[] } {
  assertLocalFs();
  const folder = path.resolve(folderPath);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new Error(`폴더를 찾을 수 없습니다: ${folder}`);
  }
  const files: LoadedLogFile[] = [];
  walkLogs(folder, "", files);
  if (!files.length) throw new Error(".log 파일을 찾지 못했습니다.");
  return { folder, files };
}
