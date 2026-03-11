import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { clientsApi } from "../api/clients";
import Pagination from "../components/ui/Pagination";
import {
  ArrowLeft,
  Users,
  Loader2,
  Home,
  Phone,
  Calendar,
  User,
  MapPin,
  ChevronDown,
  FileEdit,
} from "lucide-react";
import type { VisitRecord } from "../types";

export default function ClientDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const caseName = searchParams.get("case_name") || "";
  const orgName = searchParams.get("org_name") || "";

  const [records, setRecords] = useState<VisitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    if (!caseName || !orgName) return;
    setLoading(true);
    setError("");
    try {
      const data = await clientsApi.getRecords({
        case_name: caseName,
        org_name: orgName,
        page,
        page_size: 20,
      });
      setRecords(data.items);
      setTotalPages(data.total_pages);
    } catch {
      setError("載入紀錄失敗");
    } finally {
      setLoading(false);
    }
  }, [caseName, orgName, page]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  return (
    <div className="animate-fade-in space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/clients")}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-100 text-gray-500 transition-colors hover:bg-gray-900 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900">
          <Users className="h-5 w-5 text-primary-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">{caseName}</h2>
          <p className="text-xs font-medium text-gray-400">{orgName}</p>
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
            <Users className="h-7 w-7 text-gray-400" />
          </div>
          <p className="mt-4 text-sm font-bold text-gray-900">尚無紀錄</p>
        </div>
      )}

      {/* Records list */}
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
                      ? "border-gray-900/10 shadow-card-hover"
                      : "border-gray-200/60 shadow-card hover:shadow-card-hover"
                  }`}
                >
                  {/* Summary row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="flex w-full items-center gap-3 p-4 text-left sm:gap-4 sm:p-5"
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        isHome
                          ? "bg-gray-900 text-primary-500"
                          : "bg-gray-900 text-emerald-400"
                      }`}
                    >
                      {isHome ? <Home className="h-4.5 w-4.5" /> : <Phone className="h-4.5 w-4.5" />}
                    </div>

                    <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                      <span className="shrink-0 text-sm font-bold text-gray-900">
                        {isHome ? "家訪" : "電訪"}
                      </span>
                      <span className="text-xs font-medium text-gray-400">
                        {new Date(r.visit_date).toLocaleDateString("zh-TW")}
                      </span>
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

                    <div className="hidden shrink-0 items-center gap-4 text-xs font-medium text-gray-400 md:flex">
                      <span className="inline-flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5" />
                        {r.user_name}
                      </span>
                    </div>

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
                        <div className="mb-4 flex flex-wrap gap-2">
                          <MetaPill icon={isHome ? Home : Phone} label={isHome ? "家訪" : "電訪"} />
                          <MetaPill icon={Calendar} label={new Date(r.visit_date).toLocaleDateString("zh-TW")} />
                          <MetaPill icon={User} label={r.user_name} />
                          <MetaPill icon={MapPin} label={r.org_name || "—"} />
                        </div>

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

                        <div className="flex justify-end">
                          <button
                            onClick={() => navigate(`/records/${r.id}/edit`)}
                            className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-primary-500 transition-all hover:-translate-y-0.5 hover:shadow-md"
                          >
                            <FileEdit className="h-4 w-4" />
                            編輯紀錄
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

function MetaPill({ icon: Icon, label }: { icon: typeof Home; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-100 px-2.5 py-1.5 text-xs font-semibold text-gray-500">
      <Icon className="h-3 w-3 text-gray-400" />
      {label}
    </span>
  );
}
