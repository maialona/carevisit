import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { tokenAnalyticsApi, type TokenAnalyticsData } from "../../api/tokenAnalytics";

type Range = 1 | 7 | 30;

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: 1, label: "今日" },
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
];

const SERIES_TITLE: Record<Range, string> = {
  1: "今日每小時 Token 趨勢",
  7: "近 7 天每日 Token 趨勢",
  30: "近 30 天每日 Token 趨勢",
};

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function TokenAnalyticsPage() {
  const [range, setRange] = useState<Range>(30);
  const [data, setData] = useState<TokenAnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await tokenAnalyticsApi.get(range);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const avgPerCall =
    data && data.total_calls > 0
      ? Math.round(data.total_tokens / data.total_calls)
      : 0;

  const rangeSub: Record<Range, string> = {
    1: "今日",
    7: "近 7 天",
    30: "近 30 天",
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header + range selector */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Token 使用分析</h1>
          <p className="mt-1 text-sm text-gray-500">追蹤每位使用者的 AI Token 消耗情況</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                range === opt.value
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-gray-400">
          載入中...
        </div>
      )}

      {!loading && data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Token 用量"
              value={formatTokens(data.total_tokens)}
              sub={rangeSub[range]}
            />
            <StatCard
              label="AI 呼叫次數"
              value={data.total_calls.toLocaleString()}
              sub={rangeSub[range]}
            />
            <StatCard
              label="平均每次 Token"
              value={avgPerCall > 0 ? avgPerCall.toLocaleString() : "—"}
              sub="每次 AI 精煉平均耗用"
            />
            <StatCard
              label="有使用人數"
              value={data.by_user.filter((u) => u.call_count > 0).length.toString()}
              sub={`共 ${data.by_user.length} 位帳號`}
            />
          </div>

          {/* Time series chart */}
          {data.series.length > 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-gray-700">{SERIES_TITLE[range]}</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={data.series}
                  margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: string) =>
                      range === 1 ? v : v.slice(5)
                    }
                  />
                  <YAxis
                    tickFormatter={formatTokens}
                    tick={{ fontSize: 12, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                  />
                  <Tooltip
                    formatter={(value) => [(Number(value)).toLocaleString(), "Tokens"]}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid #e5e7eb",
                      fontSize: "12px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="total_tokens"
                    stroke="#D4FF00"
                    strokeWidth={2}
                    dot={range === 1 ? { r: 3, fill: "#D4FF00" } : false}
                    activeDot={{ r: 4, fill: "#D4FF00" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white py-12 text-sm text-gray-400 shadow-sm">
              {rangeSub[range]}尚無 Token 使用紀錄
            </div>
          )}

          {/* Per-user bar chart */}
          {data.by_user.some((u) => u.call_count > 0) && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-gray-700">
                各使用者 Token 使用量（{rangeSub[range]}）
              </h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={data.by_user.filter((u) => u.call_count > 0)}
                  margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="user_name"
                    tick={{ fontSize: 12, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={formatTokens}
                    tick={{ fontSize: 12, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                  />
                  <Tooltip
                    formatter={(value) => [(Number(value)).toLocaleString(), "Tokens"]}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid #e5e7eb",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="total_tokens" fill="#D4FF00" radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Detail table */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500">
                  <th className="px-4 py-3 text-left">使用者</th>
                  <th className="px-4 py-3 text-right">Token 用量</th>
                  <th className="px-4 py-3 text-right">呼叫次數</th>
                  <th className="px-4 py-3 text-right">平均每次</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.by_user.map((u) => (
                  <tr key={u.user_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{u.user_name}</td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {u.total_tokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">{u.call_count}</td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {u.call_count > 0
                        ? Math.round(u.total_tokens / u.call_count).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && !data && (
        <div className="flex items-center justify-center py-16 text-sm text-gray-400">
          無法載入資料
        </div>
      )}
    </div>
  );
}
