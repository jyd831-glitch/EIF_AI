export type FileAccessMode = "local" | "cloud";

export type ModeInfo = {
  mode: FileAccessMode;
  localFs: boolean;
  defaultRoot: string | null;
  message: string;
};

let cached: ModeInfo | null = null;

export async function fetchFileAccessMode(force = false): Promise<ModeInfo> {
  if (cached && !force) return cached;
  try {
    const res = await fetch("/api/mode", { cache: "no-store" });
    if (!res.ok) throw new Error("mode api failed");
    cached = (await res.json()) as ModeInfo;
    return cached;
  } catch {
    cached = {
      mode: "cloud",
      localFs: false,
      defaultRoot: null,
      message: "클라우드 모드(추정): 브라우저 폴더 선택",
    };
    return cached;
  }
}

export async function loadLogsFromLocalFolder(folder: string) {
  const res = await fetch("/api/files/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "폴더 로드 실패");
  return data as {
    folder: string;
    files: { name: string; relativePath: string; text: string }[];
  };
}
