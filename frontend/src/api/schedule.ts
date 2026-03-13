import api from "./axios";
import type {
  CaseComplianceItem,
  ComplianceListParams,
  ComplianceSummary,
  MonthlySchedule,
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

  getMonthlySchedules(caseProfileId: string) {
    return api
      .get<MonthlySchedule[]>(`/schedule/${caseProfileId}/monthly`)
      .then((r) => r.data);
  },

  upsertMonthlySchedule(caseProfileId: string, year: number, month: number, preferredDay: number) {
    return api
      .put<MonthlySchedule>(`/schedule/${caseProfileId}/monthly/${year}/${month}`, {
        preferred_day: preferredDay,
      })
      .then((r) => r.data);
  },

  deleteMonthlySchedule(caseProfileId: string, year: number, month: number) {
    return api
      .delete(`/schedule/${caseProfileId}/monthly/${year}/${month}`)
      .then((r) => r.data);
  },
};
