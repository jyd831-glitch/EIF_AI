import type { TimeFloorEvent } from "../types";
import { isAlarm } from "../alarm";
import { extractLotId } from "../lotId";
import { sfcActors } from "../sequence";

const HEADER =
  /^(?<ts>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+\[(?<level>\w+)\]\s+\[(?<module>[^\]]+)\]\s+\[(?<dir>[^\]]+)\]\s+(?<msgtype>[\w.]+)\s*:/;
const FIELD = /<(?<k>[A-Z0-9_]+)=(?<v>[^>]*)>/g;
const NAME_VALUE = /<NAME=(?<n>[^>]+)>\s*\r?\n\s*<VALUE=(?<v>[^>]*)>/g;

function extractFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of raw.matchAll(FIELD)) {
    const key = m.groups!.k;
    if (key === "NAME" || key === "VALUE") continue;
    fields[key] = m.groups!.v;
  }
  for (const m of raw.matchAll(NAME_VALUE)) {
    fields[m.groups!.n] = m.groups!.v;
  }
  return fields;
}

export function parseSfcLog(text: string, fileName: string): TimeFloorEvent[] {
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
    const body = [line];
    index++;
    while (index < lines.length) {
      const next = lines[index];
      if (!next?.trim()) {
        index++;
        break;
      }
      if (HEADER.test(next)) break;
      body.push(next);
      index++;
    }

    const raw = body.join("\n");
    const fields = extractFields(raw);
    const msgType = match.groups.msgtype;
    const direction = match.groups.dir;
    const shortType = msgType.replace(/DYNAMIC\.EVENT\./g, "");
    const actors = sfcActors(direction);
    const msgId = fields.MSGID;

    let label: string;
    let subLabel: string | undefined;
    if (msgId?.trim()) {
      label = `MESSAGE ID : ${msgId}`;
      subLabel = shortType;
    } else if (/RESPONSE/i.test(msgType)) {
      continue;
    } else {
      label = shortType;
    }

    events.push({
      id: `sfc-${fileName}-${seq++}-${headerLine}`,
      timestamp: new Date(match.groups.ts.replace(" ", "T")),
      source: "Sfc",
      category: "SFC",
      title: label,
      direction,
      messageType: msgType,
      lotId: extractLotId(fields),
      position: fields.POSITION || undefined,
      procId: fields.PROCID || undefined,
      msgId: msgId || undefined,
      from: actors?.from,
      to: actors?.to,
      label,
      subLabel,
      fields,
      isAlarm: isAlarm(fields, raw),
      rawSnippet: raw.length > 4000 ? raw.slice(0, 4000) + "…" : raw,
    });
  }

  return events;
}
