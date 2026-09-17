/** Pretty-print log payloads; unwrap nested JSON-in-string fields (e.g. Solace refDS). */

function tryParseJson(text: string): unknown | undefined {
  const t = text.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function deepExpand(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value === "string") {
    const inner = tryParseJson(value);
    if (inner !== undefined) return deepExpand(inner, depth + 1);
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => deepExpand(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepExpand(v, depth + 1);
    }
    return out;
  }
  return value;
}

function formatOneBlock(text: string): string {
  const sep = text.match(/\s:\s(?=[{\[])/);
  let header = "";
  let body = text;
  if (sep?.index != null) {
    header = text.slice(0, sep.index).trimEnd();
    body = text.slice(sep.index + sep[0].length).trim();
  }

  const parsed = tryParseJson(body);
  if (parsed !== undefined) {
    const formatted = JSON.stringify(deepExpand(parsed), null, 2);
    return header ? `${header}\n\n${formatted}` : formatted;
  }

  const whole = tryParseJson(text);
  if (whole !== undefined) {
    return JSON.stringify(deepExpand(whole), null, 2);
  }

  return text;
}

/** Pretty-print a single message payload for the detail panel. */
export function formatMessagePayload(raw?: string): string {
  if (!raw) return "";
  const text = raw.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "").trim();
  if (!text) return "";
  return formatOneBlock(text);
}
