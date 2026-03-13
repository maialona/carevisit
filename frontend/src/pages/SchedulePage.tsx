import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { scheduleApi } from "../api/schedule";
import type {
  CaseComplianceItem,
  ComplianceStatus,
  ComplianceSummary,
  PaginatedResponse,
  VisitScheduleUpsert,
} from "../types";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Users,
  Search,
  CalendarDays,
  Pencil,
  X,
  Bell,
  BellOff,
  FilePlus,
} from "lucide-react";

// ─── Badge ─────────────────────────────────────────────────────────────────

function ComplianceStatusBadge({ status }: { status: ComplianceStatus }) {
  if (status === "ok")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        達標
      </span>
    );
  if (status === "pending")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-500">
        <Clock className="h-3 w-3" />
        待訪
      </span>
    );
  if (status === "no_record")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-400">
        無紀錄
      </span>
    );
  if (status === "due_soon")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-semibold text-yellow-700">
        <Clock className="h-3 w-3" />
        即將到期
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
      <AlertTriangle className="h-3 w-3" />
      逾期
    </span>
  );
}

// ─── Summary Cards ──────────────────────────────────────────────────────────

function ComplianceSummaryCards({
  summary,
  activeFilter,
  onFilter,
}: {
  summary: ComplianceSummary | null;
  activeFilter: ComplianceStatus | null;
  onFilter: (s: ComplianceStatus | null) => void;
}) {
  const cards: {
    key: ComplianceStatus | null;
    label: string;
    value: number | undefined;
    icon: React.ReactNode;
    color: string;
    ring: string;
  }[] = [
    {
      key: "overdue",
      label: "逾期",
      value: summary?.overdue,
      icon: <AlertTriangle className="h-5 w-5" />,
      color: "bg-red-50 text-red-600",
      ring: "ring-red-400",
    },
    {
      key: "due_soon",
      label: "即將到期",
      value: summary?.due_soon,
      icon: <Clock className="h-5 w-5" />,
      color: "bg-yellow-50 text-yellow-600",
      ring: "ring-yellow-400",
    },
    {
      key: "ok",
      label: "已達標",
      value: summary?.ok,
      icon: <CheckCircle2 className="h-5 w-5" />,
      color: "bg-emerald-50 text-emerald-600",
      ring: "ring-emerald-400",
    },
    {
      key: null,
      label: "總個案數",
      value: summary?.total,
      icon: <Users className="h-5 w-5" />,
      color: "bg-surface-100 text-gray-600",
      ring: "ring-gray-300",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {cards.map((c) => (
        <button
          key={String(c.key)}
          onClick={() => onFilter(activeFilter === c.key ? null : c.key)}
          className={`card card-hover text-left p-5 transition-all ${
            activeFilter === c.key ? `ring-2 ${c.ring}` : ""
          }`}
        >
          <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${c.color}`}>
            {c.icon}
          </div>
          <p className="mt-3 text-3xl font-black text-gray-900">
            {c.value ?? "—"}
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-500">{c.label}</p>
        </button>
      ))}
    </div>
  );
}

// ─── Schedule Edit Modal ────────────────────────────────────────────────────

function ScheduleEditModal({
  item,
  onClose,
  onSaved,
}: {
  item: CaseComplianceItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [day, setDay] = useState<string>(
    item.schedule?.preferred_day_of_month?.toString() ?? ""
  );
  const [reminderEnabled, setReminderEnabled] = useState(
    item.schedule?.reminder_enabled ?? true
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const body: VisitScheduleUpsert = {
        preferred_day_of_month: day ? parseInt(day, 10) : null,
        reminder_enabled: reminderEnabled,
      };
      await scheduleApi.upsertSchedule(item.case_profile_id, body);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">
            排程設定 — {item.case_name}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-surface-100">
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-700">
            每月偏好拜訪日（1–28）
          </label>
          <input
            type="number"
            min={1}
            max={28}
            value={day}
            onChange={(e) => setDay(e.target.value)}
            placeholder="留空則不設定"
            className="input w-full"
          />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            {reminderEnabled ? (
              <Bell className="h-4 w-4 text-gray-600" />
            ) : (
              <BellOff className="h-4 w-4 text-gray-400" />
            )}
            <span className="text-sm font-semibold text-gray-700">啟用提醒</span>
          </div>
          <button
            onClick={() => setReminderEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              reminderEnabled ? "bg-gray-900" : "bg-gray-200"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                reminderEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="btn btn-secondary flex-1">
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary flex-1"
          >
            {saving ? "儲存中…" : "儲存"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

function ComplianceTable({
  items,
  isAdmin,
  onEdit,
  onNewRecord,
}: {
  items: CaseComplianceItem[];
  isAdmin: boolean;
  onEdit: (item: CaseComplianceItem) => void;
  onNewRecord: (item: CaseComplianceItem, visitType: "home" | "phone") => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-gray-200 bg-surface-50 py-16 text-sm font-medium text-gray-400">
        沒有符合條件的個案
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead className="bg-surface-50 text-xs font-bold uppercase tracking-wider text-gray-500">
          <tr>
            <th className="px-4 py-3 text-left">個案</th>
            {isAdmin && <th className="px-4 py-3 text-left">督導員</th>}
            <th className="px-4 py-3 text-left">電訪狀態</th>
            <th className="px-4 py-3 text-left">家訪狀態</th>
            <th className="px-4 py-3 text-left">排程設定</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {items.map((item) => (
            <tr key={item.case_profile_id} className="hover:bg-surface-50">
              <td className="px-4 py-3">
                <p className="font-semibold text-gray-900">{item.case_name}</p>
                <p className="text-xs text-gray-400">{item.id_number}</p>
              </td>
              {isAdmin && (
                <td className="px-4 py-3 text-gray-600">
                  {item.supervisor ?? "—"}
                </td>
              )}
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <ComplianceStatusBadge status={item.phone_compliance.status} />
                  {item.overall_status === "no_record" && (
                    <button
                      onClick={() => onNewRecord(item, "phone")}
                      title="新增電訪紀錄"
                      className="rounded-lg p-1 text-gray-300 hover:bg-surface-100 hover:text-blue-500 transition-colors"
                    >
                      <FilePlus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {item.phone_compliance.last_date && (
                  <p className="mt-0.5 text-xs text-gray-400">
                    {item.phone_compliance.last_date}
                  </p>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <ComplianceStatusBadge status={item.home_compliance.status} />
                  {item.overall_status === "no_record" && (
                    <button
                      onClick={() => onNewRecord(item, "home")}
                      title="新增家訪紀錄"
                      className="rounded-lg p-1 text-gray-300 hover:bg-surface-100 hover:text-blue-500 transition-colors"
                    >
                      <FilePlus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {item.home_compliance.last_date && (
                  <p className="mt-0.5 text-xs text-gray-400">
                    {item.home_compliance.last_date}
                  </p>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {item.schedule?.preferred_day_of_month ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                      <CalendarDays className="h-3 w-3" />
                      每月 {item.schedule.preferred_day_of_month} 日
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">未設定</span>
                  )}
                  <button
                    onClick={() => onEdit(item)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-surface-100 hover:text-gray-700 transition-colors"
                    title="編輯排程"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";

  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilter = (searchParams.get("status_filter") as ComplianceStatus) || null;

  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [data, setData] = useState<PaginatedResponse<CaseComplianceItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ComplianceStatus | null>(initialFilter);
  const [page, setPage] = useState(1);
  const [editItem, setEditItem] = useState<CaseComplianceItem | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    scheduleApi.getSummary().then(setSummary).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    setLoading(true);
    scheduleApi
      .getCompliance({
        page,
        page_size: 20,
        search: search || undefined,
        status_filter: statusFilter ?? undefined,
      })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, search, statusFilter, refreshKey]);

  const handleFilter = useCallback(
    (s: ComplianceStatus | null) => {
      setStatusFilter(s);
      setPage(1);
      if (s) {
        setSearchParams({ status_filter: s });
      } else {
        setSearchParams({});
      }
    },
    [setSearchParams]
  );

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-900">排程達成率</h1>
        <p className="mt-1 text-sm font-medium text-gray-500">
          電訪：每月至少 1 次；家訪：每 90 天至少 1 次（當月家訪可免電訪）
        </p>
      </div>

      <ComplianceSummaryCards
        summary={summary}
        activeFilter={statusFilter}
        onFilter={handleFilter}
      />

      <div className="card p-4 space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            {([null, "overdue", "due_soon", "pending", "ok"] as (ComplianceStatus | null)[]).map(
              (s) => (
                <button
                  key={String(s)}
                  onClick={() => handleFilter(s)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                    statusFilter === s
                      ? "bg-gray-900 text-primary-500"
                      : "bg-surface-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {s === null ? "全部" : s === "overdue" ? "逾期" : s === "due_soon" ? "即將到期" : s === "pending" ? "待訪" : "已達標"}
                </button>
              )
            )}
          </div>

          <div className="relative ml-auto">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="搜尋個案姓名或身分證"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="input pl-9 w-56"
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="py-16 text-center text-sm font-medium text-gray-400">
            載入中…
          </div>
        ) : (
          <ComplianceTable
            items={data?.items ?? []}
            isAdmin={isAdmin}
            onEdit={setEditItem}
            onNewRecord={(item, visitType) =>
              navigate(
                `/records/new?case_name=${encodeURIComponent(item.case_name)}&case_profile_id=${item.case_profile_id}&visit_type=${visitType}`
              )
            }
          />
        )}

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between pt-2 text-sm">
            <span className="font-medium text-gray-500">
              共 {data.total} 筆
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="btn btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
              >
                上一頁
              </button>
              <span className="flex items-center px-2 font-semibold text-gray-700">
                {page} / {data.total_pages}
              </span>
              <button
                disabled={page >= data.total_pages}
                onClick={() => setPage((p) => p + 1)}
                className="btn btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
              >
                下一頁
              </button>
            </div>
          </div>
        )}
      </div>

      {editItem && (
        <ScheduleEditModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
