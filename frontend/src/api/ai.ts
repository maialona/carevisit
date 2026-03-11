import api from "./axios";
import type { RefineParams, RefineResult, TranscribeResult, OcrResult } from "../types";

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
    api.post<RefineResult>("/ai/refine", params).then((r) => r.data),
};
