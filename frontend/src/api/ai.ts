import api, { API_URL } from "./axios";
import type {
  RefineParams,
  RefineResult,
  RefineSectionParams,
  RefineSectionResult,
  TranscribeResult,
  OcrResult,
  CheckGapsResult,
} from "../types";

export const aiApi = {
  transcribe: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api
      .post<TranscribeResult>("/ai/transcribe", form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      })
      .then((r) => r.data);
  },

  ocr: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api
      .post<OcrResult>("/ai/ocr", form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      })
      .then((r) => r.data);
  },

  refine: (params: RefineParams) =>
    api
      .post<RefineResult>("/ai/refine", params, { timeout: 60000 })
      .then((r) => r.data),

  refineStream: (
    params: RefineParams,
    onChunk: (text: string) => void,
    onDone: (fullText: string, tokensUsed: number) => void,
    onError: (message: string) => void,
  ): AbortController => {
    const controller = new AbortController();
    const token = localStorage.getItem("access_token");

    fetch(`${API_URL}/ai/refine-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.detail || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader available");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last potentially incomplete line in buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6);
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === "chunk") {
                onChunk(event.content);
              } else if (event.type === "done") {
                onDone(event.content, event.tokens_used);
              } else if (event.type === "error") {
                onError(event.message);
              }
            } catch {
              // ignore malformed JSON
            }
          }
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          onError(err.message || "串流連線失敗");
        }
      });

    return controller;
  },

  checkGaps: (text: string, visitType: "home" | "phone") =>
    api
      .post<CheckGapsResult>("/ai/check-gaps", { text, visit_type: visitType }, { timeout: 30000 })
      .then((r) => r.data),

  refineSection: (params: RefineSectionParams) =>
    api
      .post<RefineSectionResult>("/ai/refine-section", params, { timeout: 60000 })
      .then((r) => r.data),

  refineSectionStream: (
    params: RefineSectionParams,
    onChunk: (text: string) => void,
    onDone: (fullHtml: string, tokensUsed: number) => void,
    onError: (message: string) => void,
  ): AbortController => {
    const controller = new AbortController();
    const token = localStorage.getItem("access_token");

    fetch(`${API_URL}/ai/refine-section-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.detail || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader available");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6);
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === "chunk") {
                onChunk(event.content);
              } else if (event.type === "done") {
                onDone(event.content, event.tokens_used);
              } else if (event.type === "error") {
                onError(event.message);
              }
            } catch {
              // ignore malformed JSON
            }
          }
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          onError(err.message || "串流連線失敗");
        }
      });

    return controller;
  },
};
