import type { Actor, EventSource, SequenceMessage, TimeFloorEvent } from "./types";
import { isAlarm } from "./alarm";

const POS_RE = /_(\d{2})$/;

export function sfcActors(direction?: string): { from: Actor; to: Actor } | null {
  if (!direction) return null;
  const d = direction.trim();
  if (/EQP\s*->\s*MES|EIF\s*->\s*MES|FROM\s*EQP|TO\s*MES|EQP\s*→\s*MES|EIF\s*→\s*MES/i.test(d)) {
    return { from: "Eif", to: "Mes" };
  }
  if (/MES\s*->\s*EQP|MES\s*->\s*EIF|FROM\s*MES|TO\s*EQP|MES\s*→\s*EQP|MES\s*→\s*EIF/i.test(d)) {
    return { from: "Mes", to: "Eif" };
  }
  return null;
}

export function traceActors(signal: string): { from: Actor; to: Actor } {
  return signal.startsWith("I_") ? { from: "Plc", to: "Eif" } : { from: "Eif", to: "Plc" };
}

export function friendlySignalName(signal: string): string {
  let name = signal
    .replace(/I_LB_EVENT_/g, "")
    .replace(/O_LB_EVENT_/g, "")
    .replace(/I_LW_DATA_/g, "")
    .replace(/O_LW_DATA_/g, "");
  name = name.replace(POS_RE, "");
  name = name.replace(/_/g, " ");
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function extractPosition(signal?: string, fields?: Record<string, string>): string | undefined {
  if (fields?.POSITION) return fields.POSITION;
  if (!signal) return undefined;
  const m = signal.match(POS_RE);
  if (!m) return undefined;
  const n = m[1].replace(/^0+/, "");
  return n.length ? n : "0";
}

export function getSignalFamily(signal?: string): string {
  if (!signal) return "";
  return signal
    .replace(/I_LB_EVENT_/g, "")
    .replace(/O_LB_EVENT_/g, "")
    .replace(/I_LW_DATA_/g, "")
    .replace(/O_LW_DATA_/g, "");
}

export function buildBitWordSubLabel(hasBit: boolean, hasWord: boolean): string {
  if (hasBit && hasWord) return "/ B : + W :";
  if (hasBit) return "/ B :";
  if (hasWord) return "/ W :";
  return "";
}

function findMatchingWord(ordered: TimeFloorEvent[], index: number, bit: TimeFloorEvent): TimeFloorEvent | undefined {
  const family = getSignalFamily(bit.signal);
  if (!family) return undefined;
  let best: TimeFloorEvent | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  const from = Math.max(0, index - 4);
  const to = Math.min(ordered.length - 1, index + 6);
  for (let j = from; j <= to; j++) {
    const w = ordered[j];
    if (w.category !== "TRACE-DATA") continue;
    if (getSignalFamily(w.signal).toLowerCase() !== family.toLowerCase()) continue;
    const delta = Math.abs(w.timestamp.getTime() - bit.timestamp.getTime()) / 1000;
    if (delta > 2) continue;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = w;
    }
  }
  return best;
}

export function toMessages(events: TimeFloorEvent[]): SequenceMessage[] {
  const ordered = [...events].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id.localeCompare(b.id)
  );
  const messages: SequenceMessage[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const ev = ordered[i];
    if (ev.source === "Trace" && ev.category === "TRACE-DATA") continue;
    if (!ev.from || !ev.to || !ev.label?.trim()) continue;

    let hasWord = !!ev.hasWord;
    let sub = ev.subLabel;
    let word: TimeFloorEvent | undefined;

    if (ev.source === "Trace" && ev.category === "TRACE-BIT") {
      word = findMatchingWord(ordered, i, ev);
      if (word) {
        hasWord = true;
        sub = buildBitWordSubLabel(true, true);
      }
    }
    if (ev.source === "Trace" && !sub?.trim()) {
      sub = buildBitWordSubLabel(!!ev.hasBit || ev.category === "TRACE-BIT", hasWord);
    }

    const alarm =
      !!ev.isAlarm ||
      isAlarm(ev.fields, ev.rawSnippet) ||
      (!!word && (!!word.isAlarm || isAlarm(word.fields, word.rawSnippet)));

    messages.push({
      id: ev.id,
      timestamp: ev.timestamp,
      from: ev.from,
      to: ev.to,
      label: ev.label,
      subLabel: sub,
      lotId: ev.lotId ?? word?.lotId,
      position: ev.position ?? word?.position,
      source: ev.source as EventSource,
      signal: ev.signal,
      value: ev.value,
      rawSnippet: ev.rawSnippet,
      isAlarm: alarm,
      fields: ev.fields,
      wordSignal: word?.signal,
      wordTimestamp: word?.timestamp,
      wordRawSnippet: word?.rawSnippet,
      wordFields: word?.fields && Object.keys(word.fields).length ? word.fields : undefined,
    });
  }

  return messages;
}
