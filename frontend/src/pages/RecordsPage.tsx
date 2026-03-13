import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { recordsApi } from "../api/records";
import { useDebounce } from "../hooks/useDebounce";
import Pagination from "../components/ui/Pagination";
import ExportDropdown from "../components/records/ExportDropdown";
import ConfirmModal from "../components/ui/ConfirmModal";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { format } from "date-fns";
import {
  Plus,
  Home,
  Phone,
  Loader2,
  Search,
  ChevronDown,
  Calendar,
  User,
  FileEdit,
  ClipboardList,
  Clock,
  Trash2,
} from "lucide-react";
import type { VisitRecord } from "../types";
import { useToast } from "../contexts/ToastContext";

const TYPE_TABS = [
  { label: "全部", value: "" },
  { label: "家訪", value: "home" },
  { label: "電訪", value: "phone" },
];

const STATUS_OPTIONS = [
  { label: "全部狀態", value: "" },
  { label: "草稿", value: "draft" },
  { label: "已完成", value: "completed" },
];

export default function RecordsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();

  const [records, setRecords] = useState<VisitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<VisitRecord | null>(null);

  // Filters
  const [caseName, setCaseName] = useState(searchParams.get("case_name") || "");
  const [visitType, setVisitType] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const debouncedCaseName = useDebounce(caseName, 400);
  const debouncedDateFrom = useDebounce(dateFrom, 300);
  const debouncedDateTo = useDebounce(dateTo, 300);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string | number> = {
        page,
        page_size: 20,
      };
      if (debouncedCaseName) params.case_name = debouncedCaseName;
      if (visitType) params.visit_type = visitType;
      if (statusFilter) params.status = statusFilter;
      if (debouncedDateFrom) params.date_from = debouncedDateFrom;
      if (debouncedDateTo) params.date_to = debouncedDateTo;

      const data = await recordsApi.getList(params);
      setRecords(data.items);
      setTotalPages(data.total_pages);
    } catch {
      setError("載入紀錄列表失敗");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedCaseName, visitType, statusFilter, debouncedDateFrom, debouncedDateTo]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    setPage(1);
  }, [debouncedCaseName, visitType, statusFilter, debouncedDateFrom, debouncedDateTo]);

  const handleDelete = async () => {
    if (!recordToDelete) return;
    try {
      await recordsApi.delete(recordToDelete.id);
      showToast("紀錄已刪除");
      setExpandedId(null);
      fetchRecords();
    } catch {
      showToast("刪除失敗，請重試", "error");
    } finally {
      setRecordToDelete(null);
    }
  };

  return (
    <div className="animate-fade-in space-y-5">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900">
            <ClipboardList className="h-5 w-5 text-primary-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">家電訪紀錄</h2>
            <p className="text-xs font-medium text-gray-400">管理所有訪視紀錄</p>
          </div>
        </div>
        <button
          onClick={() => navigate("/records/new")}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-bold text-primary-500 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          <Plus className="h-4 w-4" />
          新增紀錄
        </button>
      </div>

      {/* Filters card */}
      <div className="card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={caseName}
              onChange={(e) => setCaseName(e.target.value)}
              placeholder="搜尋個案姓名..."
              className="input-base w-full pl-9"
            />
          </div>

          <div className="flex rounded-xl border border-gray-200 bg-surface-50 p-1">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setVisitType(tab.value)}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-bold transition-all ${
                  visitType === tab.value
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex rounded-xl border border-gray-200 bg-surface-50 p-1">
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setStatusFilter(o.value)}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-bold transition-all ${
                  statusFilter === o.value
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <DatePicker
              selected={dateFrom ? new Date(dateFrom) : null}
              onChange={(date: Date | null) => {
                if (date) {
                  setDateFrom(format(date, "yyyy-MM-dd"));
                } else {
                  setDateFrom("");
                }
              }}
              dateFormat="yyyy-MM-dd"
              placeholderText="起始日期"
              className="input-base w-36"
            />
            <span className="text-xs font-bold text-gray-300">—</span>
            <DatePicker
              selected={dateTo ? new Date(dateTo) : null}
              onChange={(date: Date | null) => {
                if (date) {
                  setDateTo(format(date, "yyyy-MM-dd"));
                } else {
                  setDateTo("");
                }
              }}
              dateFormat="yyyy-MM-dd"
              placeholderText="結束日期"
              className="input-base w-36"
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center text-sm font-medium text-red-600">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        </div>
      )}

      {/* Empty state */}
      {!loading && records.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-100">
            <ClipboardList className="h-7 w-7 text-gray-400" />
          </div>
          <p className="mt-4 text-sm font-bold text-gray-900">尚無紀錄</p>
          <p className="mt-1 text-xs text-gray-400">點擊上方「新增紀錄」開始建立</p>
        </div>
      )}

      {/* Record list */}
      {!loading && records.length > 0 && (
        <>
          <div className="space-y-3">
            {records.map((r) => {
              const isExpanded = expandedId === r.id;
              const isHome = r.visit_type === "home";
              return (
                <div
                  key={r.id}
                  className={`group rounded-2xl border bg-white transition-all duration-200 ${
                    isExpanded
                      ? "border-gray-900/10 shadow-card-hover -translate-y-0.5"
                      : "border-gray-200/60 shadow-card hover:shadow-card-hover hover:-translate-y-0.5"
                  }`}
                >
                  {/* Summary row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="flex w-full items-center gap-3 p-4 text-left sm:gap-4 sm:p-5"
                  >
                    {/* Type icon */}
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        isHome
                          ? "bg-gray-900 text-primary-500"
                          : "bg-gray-900 text-emerald-400"
                      }`}
                    >
                      {isHome ? (
                        <Home className="h-4.5 w-4.5" />
                      ) : (
                        <Phone className="h-4.5 w-4.5" />
                      )}
                    </div>

                    {/* Left info: name + area + status */}
                    <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                      <p className="shrink-0 text-sm font-bold text-gray-900 sm:text-[15px]">{r.case_name}</p>
                      <span
                        className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-bold tracking-wide ${
                          r.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : "bg-amber-500/10 text-amber-600"
                        }`}
                      >
                        {r.status === "completed" ? "已完成" : "草稿"}
                      </span>
                    </div>

                    {/* Right info: date + user + type */}
                    <div className="hidden shrink-0 items-center gap-4 text-xs font-medium text-gray-400 md:flex">
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(r.visit_date).toLocaleDateString("zh-TW")}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5" />
                        {r.user_name}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 font-semibold ${isHome ? "text-primary-600" : "text-emerald-600"}`}>
                        {isHome ? <Home className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
                        {isHome ? "家訪" : "電訪"}
                      </span>
                    </div>

                    {/* Chevron */}
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200 ${
                        isExpanded
                          ? "bg-gray-900 text-white"
                          : "bg-surface-100 text-gray-400 group-hover:bg-gray-900 group-hover:text-white"
                      }`}
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform duration-200 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </button>

                  {/* Expanded content */}
                  <div
                    className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                      isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="border-t border-gray-100 p-4 sm:p-5">
                        {/* Meta pills */}
                        <div className="mb-4 flex flex-wrap gap-2">
                          <MetaPill
                            icon={isHome ? Home : Phone}
                            label={isHome ? "家訪" : "電訪"}
                          />
                          <MetaPill
                            icon={Calendar}
                            label={new Date(r.visit_date).toLocaleDateString("zh-TW")}
                          />
                          <MetaPill icon={User} label={r.user_name} />
                          <MetaPill
                            icon={Clock}
                            label={r.output_format === "bullet" ? "條列式" : "敘述式"}
                          />
                        </div>

                        {/* Content */}
                        <div className="mb-5 rounded-xl border border-gray-100 bg-surface-50 p-4">
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                            訪視內容
                          </p>
                          <div
                            className="prose prose-sm max-w-none text-gray-600 leading-relaxed"
                            dangerouslySetInnerHTML={{
                              __html:
                                r.refined_content ||
                                r.raw_input ||
                                "<span class='text-gray-400'>尚無內容</span>",
                            }}
                          />
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            onClick={() => setRecordToDelete(r)}
                            className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-bold text-red-500 transition-all hover:-translate-y-0.5 hover:bg-red-50 hover:shadow-sm"
                          >
                            <Trash2 className="h-4 w-4" />
                            刪除紀錄
                          </button>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => navigate(`/records/${r.id}/edit`)}
                              className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-primary-500 transition-all hover:-translate-y-0.5 hover:shadow-md"
                            >
                              <FileEdit className="h-4 w-4" />
                              編輯紀錄
                            </button>
                            <ExportDropdown
                              recordId={r.id}
                              caseName={r.case_name}
                              visitDate={r.visit_date}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </>
      )}

      <ConfirmModal
        open={!!recordToDelete}
        title="刪除訪視紀錄"
        message={`確定要刪除「${recordToDelete?.case_name}」的訪視紀錄嗎？此操作無法復原。`}
        confirmLabel="確認刪除"
        danger
        onConfirm={handleDelete}
        onCancel={() => setRecordToDelete(null)}
      />
    </div>
  );
}

/* ─── Sub-components ─── */

function MetaPill({
  icon: Icon,
  label,
}: {
  icon: typeof Home;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-100 px-2.5 py-1.5 text-xs font-semibold text-gray-500">
      <Icon className="h-3 w-3 text-gray-400" />
      {label}
    </span>
  );
}

