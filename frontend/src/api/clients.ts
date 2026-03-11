import api from "./axios";
import type {
  ClientCard,
  ClientListParams,
  ClientRecordParams,
  PaginatedResponse,
  VisitRecord,
} from "../types";

export const clientsApi = {
  getList: (params: ClientListParams) =>
    api
      .get<PaginatedResponse<ClientCard>>("/clients", { params })
      .then((r) => r.data),

  getRecords: (params: ClientRecordParams) =>
    api
      .get<PaginatedResponse<VisitRecord>>("/clients/records", { params })
      .then((r) => r.data),
};
