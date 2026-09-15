import type { TimeFloorEvent } from "../types";
import { isAlarm } from "../alarm";

const HEADER =
  /^\[?(?<ts>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\]?\s+\[(?<level>\w+)\]\s+\[(?<module>[^\]]+)\]\s+\((?<kind>[A-Z_]+)\)\s+(?<rest>.*)$/;
const TS_START = /^\[?\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\]?\s+\[/;

function shortActId(actId: string) {
  return actId.startsWith("BR_") ? actId.slice(3) : actId;
}

function ignored(actId: string) {
  return /^(BR_)?SFC_RegisterTransactionLogEIF$/i.test(actId);
}

function pick(re: RegExp, text: string) {
  const m = text.match(re);
  return m?.[1] ?? m?.groups?.v ?? "";
}

export function parseSolaceLog(text: string, fileName: string): TimeFloorEvent[] {
  const lines = text.split(/\r?\n/);
  const events: TimeFloorEvent[] = [];
  let index = 0;
  let seq = 0;
  const skipped = new Set<string>();
  const bizById = new Map<string, string>();
  const lotById = new Map<string, string>();

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

    const kind = match.groups.kind;
    if (kind !== "REQUEST" && kind !== "RECEIVE_REPLYQ") {
      index++;
      continue;
    }

    const headerLine = index;
    const body = [line];
    index++;
    while (index < lines.length) {
      const next = lines[index];
      if (TS_START.test(next)) break;
      body.push(next);
      index++;
    }

    const raw = body.join("\n");
    const rest = match.groups.rest;
    const ts = new Date(match.groups.ts.replace(" ", "T"));

    if (kind === "REQUEST") {
      const actId = pick(/"actID"\s*:\s*"([^"]+)"/, raw) || "REQUEST";
      const uuid = pick(/EIF\/RAW_DATA\(([^)]+)\)/, rest);
      if (ignored(actId)) {
        if (uuid) skipped.add(uuid);
        continue;
      }

      let lotId = pick(/\\?"LOT_ID\\?"\s*:\s*\\?"([^\\"]*)\\?"/, raw);
      if (!lotId) lotId = pick(/\\?"BARCODE_VALUE\\?"\s*:\s*\\?"([^\\"]*)\\?"/, raw);
      const streamId = pick(/\\?"STREAM_FUNCTION_ID\\?"\s*:\s*\\?"([^\\"]*)\\?"/, raw);
      const eifId = pick(/ID=\\+"([^\\"]+)\\+"/, raw);
      const eifName = pick(/NAME=\\+"([^\\"]*)\\+"/, raw);
      const result = pick(/\\?"RESULT\\?"\s*:\s*\\?"([^\\"]*)\\?"/, raw) || pick(/<RESULT>([^<]*)<\/RESULT>/i, raw);
      const lineStop = pick(/\\?"LINESTOP\\?"\s*:\s*\\?"([^\\"]*)\\?"/, raw) || pick(/<LINESTOP>([^<]*)<\/LINESTOP>/i, raw);

      const bizName = shortActId(actId);
      let subLabel = "REQUEST";
      if (streamId) subLabel = eifName ? `${streamId} ${eifName}` : streamId;
      else if (eifId) subLabel = eifName ? `${eifId} ${eifName}` : eifId;

      const fields: Record<string, string> = { ACT_ID: actId, KIND: "REQUEST" };
      if (streamId) fields.STREAM_FUNCTION_ID = streamId;
      if (uuid) fields.CORRELATION_ID = uuid;
      if (result) fields.RESULT = result;
      if (lineStop) fields.LINESTOP = lineStop;

      if (uuid) {
        bizById.set(uuid, bizName);
        if (lotId) lotById.set(uuid, lotId);
      }

      events.push({
        id: `solace-${fileName}-${seq++}-${headerLine}`,
        timestamp: ts,
        source: "Sfc",
        category: "SOLACE",
        title: bizName,
        direction: "EIF->MES",
        messageType: actId,
        lotId: lotId || undefined,
        msgId: streamId || undefined,
        from: "Eif",
        to: "Mes",
        label: bizName,
        subLabel,
        fields,
        isAlarm: isAlarm(fields, raw),
        rawSnippet: raw.length > 4000 ? raw.slice(0, 4000) + "…" : raw,
      });
    } else {
      const uuid = pick(/\(([0-9a-fA-F-]{36})\)\s*:/, rest);
      if (uuid && skipped.has(uuid)) continue;
      const jobCode = pick(/"JOB_CODE"\s*:\s*"([^"]*)"/, raw);
      const bizName = uuid ? bizById.get(uuid) : undefined;
      const lotId = uuid ? lotById.get(uuid) : undefined;
      const label = bizName || (jobCode ? `REPLY JOB : ${jobCode}` : "REPLY");
      const subLabel = jobCode ? `REPLY : ${jobCode}` : "REPLY";
      const fields: Record<string, string> = { KIND: "RECEIVE_REPLYQ" };
      if (uuid) fields.CORRELATION_ID = uuid;
      if (jobCode) fields.JOB_CODE = jobCode;
      if (bizName) fields.ACT_ID = bizName;

      events.push({
        id: `solace-${fileName}-${seq++}-${headerLine}`,
        timestamp: ts,
        source: "Sfc",
        category: "SOLACE",
        title: label,
        direction: "MES->EIF",
        messageType: "RECEIVE_REPLYQ",
        lotId,
        from: "Mes",
        to: "Eif",
        label,
        subLabel,
        fields,
        isAlarm: isAlarm(fields, raw),
        rawSnippet: raw.length > 4000 ? raw.slice(0, 4000) + "…" : raw,
      });
    }
  }

  return events;
}
