import api from "./axios";
import type { AuditLogEntry, PaginatedResponse } from "../types";

export const auditApi = {
  getList: (params?: { page?: number; page_size?: number; action?: string }) =>
    api.get<PaginatedResponse<AuditLogEntry>>("/audit", { params }).then((r) => r.data),
};
