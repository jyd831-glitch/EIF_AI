const RESULT_RE =
  /(?:\\?"RESULT\\?"\s*:\s*\\?"?(?<r>2|NG)\\?"?)|(?:<RESULT>\s*(?<r>2|NG)\s*<\/RESULT>)|(?:\[RESULT\]\s*:\s*(?<r>2|NG)\b)|(?:RESULT\s*[=:]\s*(?<r>2|NG)\b)|(?:<NAME\s*=\s*RESULT>\s*<VALUE\s*=\s*(?<r>2|NG)>)/i;

const LINESTOP_RE =
  /(?:\\?"LINESTOP\\?"\s*:\s*\\?"?(?<v>1)\\?"?)|(?:<LINESTOP>\s*(?<v>1)\s*<\/LINESTOP>)|(?:\[LINESTOP\]\s*:\s*(?<v>1)\b)|(?:LINESTOP\s*[=:]\s*(?<v>1)\b)|(?:<NAME\s*=\s*LINESTOP>\s*<VALUE\s*=\s*(?<v>1)>)/i;

export function isBadResult(value?: string): boolean {
  if (!value) return false;
  const v = value.trim().replace(/^["']|["']$/g, "");
  return v === "2" || v.toUpperCase() === "NG";
}

export function isLineStopOn(value?: string): boolean {
  if (!value) return false;
  return value.trim().replace(/^["']|["']$/g, "") === "1";
}

export function isAlarm(fields?: Record<string, string>, raw?: string): boolean {
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (key.toUpperCase() === "RESULT" && isBadResult(value)) return true;
      if (key.toUpperCase() === "LINESTOP" && isLineStopOn(value)) return true;
    }
  }
  if (!raw) return false;
  return RESULT_RE.test(raw) || LINESTOP_RE.test(raw);
}
