import api from "./axios";
import type {
  CaseProfile,
  CaseProfileCreate,
  CaseProfileUpdate,
  ImportConfirmResponse,
  ImportPreviewResponse,
  ImportPreviewRow,
  PaginatedResponse,
} from "../types";

export const caseProfilesApi = {
  getList: (params: {
    page?: number;
    page_size?: number;
    search?: string;
    service_status?: string;
  }) => api.get<PaginatedResponse<CaseProfile>>("/case-profiles", { params }),

  create: (body: CaseProfileCreate) =>
    api.post<CaseProfile>("/case-profiles", body),

  update: (id: string, body: CaseProfileUpdate) =>
    api.put<CaseProfile>(`/case-profiles/${id}`, body),

  delete: (id: string) => api.delete(`/case-profiles/${id}`),

  importPreview: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<ImportPreviewResponse>("/case-profiles/import/preview", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  importConfirm: (rows: ImportPreviewRow[]) =>
    api.post<ImportConfirmResponse>("/case-profiles/import/confirm", { rows }),

  batchDelete: (ids: string[]) =>
    api.delete<{ deleted: number }>("/case-profiles/batch", { data: { ids } }),

  searchNames: (q: string) =>
    api.get<string[]>("/case-profiles/search", { params: { q } }),
};
