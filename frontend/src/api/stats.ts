import api from "./axios";

import type { VisitRecord } from "../types";

export interface DashboardStats {
  home_visits_this_month: number;
  phone_visits_this_month: number;
  pending_records: number;
  total_records: number;
  recent_records: VisitRecord[];
}

export const statsApi = {
  getDashboardStats: () => api.get<DashboardStats>("/stats").then((res) => res.data),
};
