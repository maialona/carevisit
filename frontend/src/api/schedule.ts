import api from "./axios";
import type {
  CaseComplianceItem,
  ComplianceListParams,
  ComplianceSummary,
  PaginatedResponse,
  VisitSchedule,
  VisitScheduleUpsert,
} from "../types";

export const scheduleApi = {
  getCompliance(params?: ComplianceListParams) {
    return api
      .get<PaginatedResponse<CaseComplianceItem>>("/schedule/compliance", {
        params,
      })
      .then((r) => r.data);
  },

  getSummary() {
    return api
      .get<ComplianceSummary>("/schedule/compliance/summary")
      .then((r) => r.data);
  },

  getSchedule(caseProfileId: string) {
    return api
      .get<VisitSchedule | null>(`/schedule/${caseProfileId}`)
      .then((r) => r.data);
  },

  upsertSchedule(caseProfileId: string, body: VisitScheduleUpsert) {
    return api
      .put<VisitSchedule>(`/schedule/${caseProfileId}`, body)
      .then((r) => r.data);
  },
};
