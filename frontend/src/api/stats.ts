import api from "./axios";

export interface DashboardStats {
  home_visits_this_month: number;
  phone_visits_this_month: number;
  pending_records: number;
  total_records: number;
}

export const statsApi = {
  getDashboardStats: () => api.get<DashboardStats>("/stats").then((res) => res.data),
};
