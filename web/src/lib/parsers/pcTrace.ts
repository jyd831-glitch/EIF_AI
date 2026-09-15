import type { TimeFloorEvent } from "../types";
import { isAlarm } from "../alarm";

const HEADER =
  /^(?<ts>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+\[(?<level>\w+)\]\s+\[[^\]]*\]\s+\[(?<dir>RECV|SEND)\(ASC\)\]\s*:\s*(?<rest>.*)$/;
const TS_START = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\[/;

export function isPcAscTrace(text: string): boolean {
  return text.includes("RECV(ASC)") || text.includes("SEND(ASC)");
}

export function parsePcTraceLog(text: string, fileName: string): TimeFloorEvent[] {
  const lines = text.split(/\r?\n/);
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

    const xmlText = body.join("\n").trim();
    if (!/<EIF/i.test(xmlText)) continue;

    const fields: Record<string, string> = { DIR: dir };
    const idM = xmlText.match(/\bID\s*=\s*"([^"]+)"/i);
    const nameM = xmlText.match(/\bNAME\s*=\s*"([^"]+)"/i);
    const setM = xmlText.match(/<SETID>([^<]*)<\/SETID>/i);
    const procM = xmlText.match(/<PROCID>([^<]*)<\/PROCID>/i);
    const resultM = xmlText.match(/<RESULT>([^<]*)<\/RESULT>/i);
    const lineStopM = xmlText.match(/<LINESTOP>([^<]*)<\/LINESTOP>/i);

    const eifId = idM?.[1];
    const eifName = nameM?.[1];
    if (eifId) fields.ID = eifId;
    if (eifName) fields.NAME = eifName;
    if (setM) fields.SETID = setM[1];
    if (procM) fields.PROCID = procM[1];
    if (resultM) fields.RESULT = resultM[1];
    if (lineStopM) fields.LINESTOP = lineStopM[1];

    const label = eifId ? (eifName ? `${eifId} ${eifName}` : eifId) : `${dir}(ASC)`;
    const from = dir === "RECV" ? "Plc" : "Eif";
    const to = dir === "RECV" ? "Eif" : "Plc";

    events.push({
      id: `pctrace-${fileName}-${seq++}-${headerLine}`,
      timestamp: new Date(match.groups.ts.replace(" ", "T")),
      source: "Trace",
      category: "TRACE-ASC",
      title: label,
      direction: dir,
      messageType: eifId,
      signal: eifId,
      lotId: setM?.[1] || undefined,
      procId: procM?.[1] || undefined,
      from,
      to,
      label,
      subLabel: dir,
      fields,
      isAlarm: isAlarm(fields, xmlText),
      rawSnippet: xmlText.length > 4000 ? xmlText.slice(0, 4000) + "…" : xmlText,
    });
  }

  return events;
}
