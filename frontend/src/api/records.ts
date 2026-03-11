import api from "./axios";
import type {
  PaginatedResponse,
  RecordListParams,
  VisitRecord,
  VisitRecordCreate,
  VisitRecordUpdate,
} from "../types";

export const recordsApi = {
  getList: (params: RecordListParams) =>
    api
      .get<PaginatedResponse<VisitRecord>>("/records", { params })
      .then((r) => r.data),

  getById: (id: string) =>
    api.get<VisitRecord>(`/records/${id}`).then((r) => r.data),

  create: (data: VisitRecordCreate) =>
    api.post<VisitRecord>("/records", data).then((r) => r.data),

  update: (id: string, data: VisitRecordUpdate) =>
    api.put<VisitRecord>(`/records/${id}`, data).then((r) => r.data),

  delete: (id: string) =>
    api.delete(`/records/${id}`).then(() => undefined),
};
