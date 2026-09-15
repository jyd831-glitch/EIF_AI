import type { TimeFloorEvent } from "../types";
import { isAlarm } from "../alarm";
import { buildBitWordSubLabel, extractPosition, friendlySignalName, traceActors } from "../sequence";

const HEADER =
  /^(?<ts>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+\[(?<level>\w+)\]\s+\[(?<module>[^\]]+)\]\s+\[(?<signal>[^\]]+)\]\s+\((?<type>[^)]+)\)\s*:\s*(?<value>.*)$/;
const FIELD_LINE = /^\[(?<k>[^\]]+)\]\s*:\s*(?<v>.*)$/;

export function parseTraceLog(text: string, fileName: string, includeBitOff = true): TimeFloorEvent[] {
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
    const signal = match.groups.signal;
    const valueType = match.groups.type;
    const value = match.groups.value.trim();
    const fields: Record<string, string> = {};
    const body = [line];
    index++;

    if (/^Structure$/i.test(valueType)) {
      while (index < lines.length) {
        const next = lines[index];
        if (!next?.trim()) {
          index++;
          break;
        }
        if (HEADER.test(next)) break;
        body.push(next);
        const fm = next.trim().match(FIELD_LINE);
        if (fm?.groups) fields[fm.groups.k] = fm.groups.v.trim();
        index++;
      }
    }

    const isBit = /^Boolean$/i.test(valueType);
    if (!includeBitOff && isBit && /^OFF$/i.test(value)) {
      continue;
    }

    const isData = signal.includes("_LW_DATA_");
    const { from, to } = traceActors(signal);
    const friendly = friendlySignalName(signal);
    const bitState = /^ON$/i.test(value) ? "Bit On" : /^OFF$/i.test(value) ? "Bit Off" : value;

    let label: string;
    let subLabel: string;
    if (isData) {
      label = `${friendly} ( Word )`;
      subLabel = buildBitWordSubLabel(false, true);
    } else {
      if (/Request$/i.test(friendly) && /^OFF$/i.test(value) && !/Confirm/i.test(friendly)) {
        label = `${friendly} Report ( ${bitState} )`;
      } else {
        label = `${friendly} ( ${bitState} )`;
      }
      subLabel = buildBitWordSubLabel(true, false);
    }

    const raw = body.join("\n");
    events.push({
      id: `trc-${fileName}-${seq++}-${headerLine}`,
      timestamp: new Date(match.groups.ts.replace(" ", "T")),
      source: "Trace",
      category: isData ? "TRACE-DATA" : "TRACE-BIT",
      title: label,
      direction: from === "Plc" ? "PLC->EIF" : "EIF->PLC",
      signal,
      lotId: fields.LOTID || undefined,
      position: extractPosition(signal, fields),
      value: value || undefined,
      from,
      to,
      label,
      subLabel,
      hasBit: isBit,
      hasWord: isData,
      fields,
      isAlarm: isAlarm(fields, raw),
      rawSnippet: raw.length > 4000 ? raw.slice(0, 4000) + "…" : raw,
    });
  }

  return events;
}
