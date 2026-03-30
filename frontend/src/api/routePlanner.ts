import { API_URL } from "./axios";

export const DEFAULT_ORIGIN = "台南市北區臨安路二段17號";

export interface RouteStop {
  order: number;
  case_id: string;
  name: string;
  address: string;
  formatted_address: string;
  compliance: "overdue" | "due_soon";
  duration_from_prev_min: number | null;
  distance_from_prev_km: number | null;
  lat?: number;
  lng?: number;
}

export interface MissingCase {
  name: string;
  address: string;
  compliance: "overdue" | "due_soon";
}

export interface RouteResult {
  route: RouteStop[];
  total_duration_min: number;
  total_distance_km: number;
  origin: string;
  missing_cases: MissingCase[];
  warnings: string[];
  summary: string;
}

export interface ThinkingLog {
  step: "ACT" | "OBSERVE" | "REFLECT";
  content: string;
}

interface StreamCallbacks {
  onThinking: (log: ThinkingLog) => void;
  onResult: (result: RouteResult) => void;
  onDone: () => void;
  onError: (msg: string) => void;
}

async function _readStream(res: Response, cb: StreamCallbacks) {
  if (!res.ok) {
    cb.onError(`HTTP ${res.status}`);
    cb.onDone();
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "thinking") {
          cb.onThinking({ step: data.step, content: data.content });
        } else if (data.type === "result") {
          cb.onResult(data as RouteResult);
        } else if (data.type === "error") {
          cb.onError(data.message ?? "未知錯誤");
        } else if (data.type === "done") {
          cb.onDone();
        }
      } catch {
        // ignore malformed line
      }
    }
  }
  cb.onDone();
}

export function streamRoutePlan(
  targetDate: string,
  origin: string,
  onThinking: (log: ThinkingLog) => void,
  onResult: (result: RouteResult) => void,
  onDone: () => void,
  onError: (msg: string) => void,
): AbortController {
  const ctrl = new AbortController();
  const token = localStorage.getItem("access_token");
  const params = new URLSearchParams({ target_date: targetDate });
  if (origin.trim()) params.append("origin", origin.trim());

  fetch(`${API_URL}/route/plan?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    signal: ctrl.signal,
  })
    .then((res) => _readStream(res, { onThinking, onResult, onDone, onError }))
    .catch((err) => {
      if (err.name !== "AbortError") {
        onError("連線失敗，請稍後再試");
        onDone();
      }
    });

  return ctrl;
}

export function streamManualRoutePlan(
  caseIds: string[],
  origin: string,
  onThinking: (log: ThinkingLog) => void,
  onResult: (result: RouteResult) => void,
  onDone: () => void,
  onError: (msg: string) => void,
): AbortController {
  const ctrl = new AbortController();
  const token = localStorage.getItem("access_token");

  fetch(`${API_URL}/route/plan-manual`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ case_ids: caseIds, origin: origin.trim() || null }),
    signal: ctrl.signal,
  })
    .then((res) => _readStream(res, { onThinking, onResult, onDone, onError }))
    .catch((err) => {
      if (err.name !== "AbortError") {
        onError("連線失敗，請稍後再試");
        onDone();
      }
    });

  return ctrl;
}
