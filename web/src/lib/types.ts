export type Actor = "Mes" | "Eif" | "Plc";
export type EventSource = "Sfc" | "Trace";

export interface TimeFloorEvent {
  id: string;
  timestamp: Date;
  source: EventSource;
  category: string;
  title: string;
  direction?: string;
  signal?: string;
  messageType?: string;
  lotId?: string;
  position?: string;
  procId?: string;
  msgId?: string;
  value?: string;
  from?: Actor;
  to?: Actor;
  label?: string;
  subLabel?: string;
  hasBit?: boolean;
  hasWord?: boolean;
  isAlarm?: boolean;
  fields: Record<string, string>;
  rawSnippet?: string;
}

export interface SequenceMessage {
  id: string;
  timestamp: Date;
  from: Actor;
  to: Actor;
  label: string;
  subLabel?: string;
  lotId?: string;
  position?: string;
  source: EventSource;
  signal?: string;
  value?: string;
  rawSnippet?: string;
  isAlarm?: boolean;
  fields: Record<string, string>;
  wordSignal?: string;
  wordTimestamp?: Date;
  wordRawSnippet?: string;
  wordFields?: Record<string, string>;
}

export interface TimeFloorResult {
  sessionId: string;
  logType: string;
  equipmentKey: string;
  lotId?: string;
  startTime?: Date;
  endTime?: Date;
  totalEvents: number;
  lotIds: string[];
  events: TimeFloorEvent[];
  messages: SequenceMessage[];
}

export interface LogFile {
  name: string;
  relativePath: string;
  text: string;
  /** Kept so refresh can re-read without opening the folder picker again */
  sourceFile?: File;
}
