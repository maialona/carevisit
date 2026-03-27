import api from "./axios";

export interface UserTokenUsage {
  user_id: string;
  user_name: string;
  total_tokens: number;
  call_count: number;
}

export interface SeriesPoint {
  label: string;
  total_tokens: number;
  call_count: number;
}

export interface TokenAnalyticsData {
  total_tokens: number;
  total_calls: number;
  by_user: UserTokenUsage[];
  series: SeriesPoint[];
  granularity: "hour" | "day";
}

export const tokenAnalyticsApi = {
  get: (days: number) =>
    api.get<TokenAnalyticsData>("/token-analytics", { params: { days } }).then((r) => r.data),
};
