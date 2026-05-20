export type EventType =
  | "session_start"
  | "session_end"
  | "tool_use"
  | "tool_result"
  | "prompt_submit"
  | "assistant_stop"
  | "subagent_stop"
  | "pre_compact"
  | "skill_use"
  | "stop"
  | "error";

export interface TelemetryEvent {
  id: string;
  user_id: string;
  session_id: string;
  event_type: EventType;
  timestamp: string;
  seq: number;
  tool_name: string | null;
  duration_ms: number | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface IngestEvent {
  ts: string;
  event: EventType;
  session_id: string;
  seq: number;
  data: Record<string, unknown>;
}

export interface IngestPayload {
  events: IngestEvent[];
}
