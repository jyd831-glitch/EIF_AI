import type { TimeFloorEvent } from "../types";
import { isAlarm } from "../alarm";
import { extractLotId } from "../lotId";

const HEADER =
  /^(?<ts>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+\[(?<level>\w+)\]\s+\[[^\]]*\]\s+\[(?<dir>RECV|SEND)\(ASC\)\]\s*:\s*(?<rest>.*)$/;
const TS_START = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\[/;

/** Heartbeat / link-check noise (no lot payload). */
const SKIP_MSG = /^(ELNT|ELNT_R)$/i;

export function isPcAscTrace(text: string): boolean {
  return text.includes("RECV(ASC)") || text.includes("SEND(ASC)");
}

function stripControl(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
}

function collectFields(node: unknown, out: Record<string, string>): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (
        item &&
        typeof item === "object" &&
        "NAME" in item &&
        "VALUE" in item &&
        typeof (item as { NAME: unknown }).NAME === "string"
      ) {
        const row = item as { NAME: string; VALUE: unknown };
        out[row.NAME] = String(row.VALUE ?? "");
      } else {
        collectFields(item, out);
      }
    }
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (v != null && typeof v === "object") {
        collectFields(v, out);
      } else if (v != null && v !== "") {
        out[k] = String(v);
      }
    }
  }
}

function parseJsonAscBody(
  raw: string
): { msgType: string; fields: Record<string, string>; pretty: string } | null {
  const cleaned = stripControl(raw);
  if (!cleaned.startsWith("{")) return null;
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const keys = Object.keys(obj);
    if (!keys.length) return null;
    const msgType = keys[0];
    const fields: Record<string, string> = { MSGTYPE: msgType };
    collectFields(obj[msgType], fields);
    return { msgType, fields, pretty: JSON.stringify(obj, null, 2) };
  } catch {
    return null;
  }
}

function parseXmlAscBody(
  raw: string
): { msgType: string; fields: Record<string, string>; pretty: string } | null {
  const xmlText = stripControl(raw);
  if (!/<EIF/i.test(xmlText)) return null;

  const fields: Record<string, string> = {};
  const idM = xmlText.match(/\bID\s*=\s*"([^"]+)"/i);
  const nameM = xmlText.match(/\bNAME\s*=\s*"([^"]+)"/i);
  const setM = xmlText.match(/<SETID>([^<]*)<\/SETID>/i);
  const procM = xmlText.match(/<PROCID>([^<]*)<\/PROCID>/i);
  const resultM = xmlText.match(/<RESULT>([^<]*)<\/RESULT>/i);
  const lineStopM = xmlText.match(/<LINESTOP>([^<]*)<\/LINESTOP>/i);

  if (idM) fields.ID = idM[1];
  if (nameM) fields.NAME = nameM[1];
  if (setM) fields.SETID = setM[1];
  if (procM) fields.PROCID = procM[1];
  if (resultM) fields.RESULT = resultM[1];
  if (lineStopM) fields.LINESTOP = lineStopM[1];

  const msgType = idM?.[1] || "EIF";
  return { msgType, fields, pretty: xmlText };
}

export function parsePcTraceLog(text: string, fileName: string): TimeFloorEvent[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const events: TimeFloorEvent[] = [];
  let index = 0;
  let seq = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line?.trim()) {
      index++;
      continue;
    }
    const match = line.match(HEADER);
    if (!match?.groups) {
      index++;
      continue;
    }

    const headerLine = index;
    const dir = match.groups.dir;
    const body: string[] = [];
    if (match.groups.rest.trim()) body.push(match.groups.rest);
    index++;
    while (index < lines.length) {
      const next = lines[index];
      if (TS_START.test(next)) break;
      body.push(next);
      index++;
    }

    const rawBody = body.join("\n");
    const parsed = parseJsonAscBody(rawBody) || parseXmlAscBody(rawBody);
    if (!parsed) continue;
    if (SKIP_MSG.test(parsed.msgType)) continue;

    const fields: Record<string, string> = { DIR: dir, ...parsed.fields };
    const lotId = extractLotId(fields);
    const fromJson = parsed.pretty.trimStart().startsWith("{");
    const label = fromJson
      ? parsed.msgType
      : parsed.fields.ID
        ? parsed.fields.NAME
          ? `${parsed.fields.ID} ${parsed.fields.NAME}`
          : parsed.fields.ID
        : parsed.msgType;
    const from = dir === "RECV" ? "Plc" : "Eif";
    const to = dir === "RECV" ? "Eif" : "Plc";

    events.push({
      id: `pctrace-${fileName}-${seq++}-${headerLine}`,
      timestamp: new Date(match.groups.ts.replace(" ", "T")),
      source: "Trace",
      category: "TRACE-ASC",
      title: label,
      direction: dir,
      messageType: parsed.msgType,
      signal: parsed.msgType,
      lotId: lotId || undefined,
      procId: fields.PROCID || undefined,
      from,
      to,
      label,
      subLabel: dir,
      fields,
      isAlarm: isAlarm(fields, parsed.pretty),
      rawSnippet:
        parsed.pretty.length > 4000 ? parsed.pretty.slice(0, 4000) + "…" : parsed.pretty,
    });
  }

  return events;
}
