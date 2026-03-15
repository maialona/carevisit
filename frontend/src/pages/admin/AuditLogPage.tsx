import { useState, useEffect, useCallback } from "react";
import { auditApi } from "../../api/audit";
import type { AuditLogEntry } from "../../types";

const ACTION_LABELS: Record<string, string> = {
  record_create: "建立訪視紀錄",
  record_update: "更新訪視紀錄",
  record_delete: "刪除訪視紀錄",
  case_create: "建立個案",
  case_update: "更新個案",
  case_delete: "刪除個案",
  case_import: "匯入個案",
  user_create: "建立帳號",
  user_update: "更新帳號",
  user_deactivate: "停用帳號",
  user_delete: "刪除帳號",
  user_reset_pw: "重設密碼",
};

const RESOURCE_LABELS: Record<string, string> = {
  visit_record: "訪視紀錄",
  case_profile: "個案",
  user: "帳號",
};

type BadgeVariant = "green" | "blue" | "red" | "purple" | "amber" | "gray";

function getActionBadge(action: string): { label: string; variant: BadgeVariant } {
  const label = ACTION_LABELS[action] ?? action;
  if (action.endsWith("_create")) return { label, variant: "green" };
  if (action.endsWith("_update")) return { label, variant: "blue" };
  if (action.endsWith("_delete")) return { label, variant: "red" };
  if (action.endsWith("_import")) return { label, variant: "purple" };
  if (action.endsWith("_deactivate")) return { label, variant: "amber" };
  return { label, variant: "gray" };
}

const BADGE_CLASSES: Record<BadgeVariant, string> = {
  green: "bg-green-50 text-green-700",
  blue: "bg-blue-50 text-blue-700",
  red: "bg-red-50 text-red-700",
  purple: "bg-purple-50 text-purple-700",
  amber: "bg-amber-50 text-amber-700",
  gray: "bg-gray-100 text-gray-700",
};

function ActionBadge({ action }: { action: string }) {
  const { label, variant } = getActionBadge(action);
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_CLASSES[variant]}`}>
      {label}
    </span>
  );
}

function renderDetail(entry: AuditLogEntry): string | null {
  if (!entry.detail) return null;
  const d = entry.detail;
  if (entry.action === "case_import") {
    return `建立 ${d.created ?? 0}、更新 ${d.updated ?? 0}、錯誤 ${d.errors ?? 0}`;
  }
  if (entry.action === "case_delete" && d.count !== undefined) {
    return `共 ${d.count} 筆`;
  }
  return null;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }));

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const pageSize = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await auditApi.getList({
        page,
        page_size: pageSize,
        action: actionFilter || undefined,
      });
      setEntries(res.items);
      setTotal(res.total);
      setTotalPages(res.total_pages);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFilterChange = (value: string) => {
    setActionFilter(value);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">操作記錄</h1>
        <p className="mt-1 text-sm text-gray-500">所有建立、更新、刪除、匯入操作的完整記錄</p>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={actionFilter}
          onChange={(e) => handleFilterChange(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">全部動作</option>
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="text-sm text-gray-400">共 {total} 筆</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-gray-400">載入中...</div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-gray-400">尚無操作記錄</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500">
                <th className="px-4 py-3 text-left">時間</th>
                <th className="px-4 py-3 text-left">操作者</th>
                <th className="px-4 py-3 text-left">動作</th>
                <th className="px-4 py-3 text-left">對象</th>
                <th className="px-4 py-3 text-left">備註</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">{formatDate(entry.created_at)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{entry.actor_name}</td>
                  <td className="px-4 py-3">
                    <ActionBadge action={entry.action} />
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <span className="text-gray-400">{RESOURCE_LABELS[entry.resource_type] ?? entry.resource_type}</span>
                    {entry.resource_label && (
                      <span className="ml-1 font-medium text-gray-800">· {entry.resource_label}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{renderDetail(entry) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            上一頁
          </button>
          <span className="text-sm text-gray-500">
            第 {page} / {totalPages} 頁
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            下一頁
          </button>
        </div>
      )}
    </div>
  );
}
