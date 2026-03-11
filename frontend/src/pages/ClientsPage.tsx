import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clientsApi } from "../api/clients";
import { useDebounce } from "../hooks/useDebounce";
import Pagination from "../components/ui/Pagination";
import { Users, Search, Loader2, Calendar, MapPin, FileText } from "lucide-react";
import type { ClientCard } from "../types";

export default function ClientsPage() {
  const navigate = useNavigate();

  const [clients, setClients] = useState<ClientCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");

  const debouncedSearch = useDebounce(search, 400);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string | number> = {
        page,
        page_size: 18,
      };
      if (debouncedSearch) params.search = debouncedSearch;

      const data = await clientsApi.getList(params);
      setClients(data.items);
      setTotalPages(data.total_pages);
    } catch {
      setError("載入個案列表失敗");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  return (
    <div className="animate-fade-in space-y-5">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900">
          <Users className="h-5 w-5 text-primary-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">個案卡片</h2>
          <p className="text-xs font-medium text-gray-400">瀏覽所有個案的訪視歷程</p>
        </div>
      </div>

      {/* Search */}
      <div className="card p-4">
        <div className="relative sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋個案姓名..."
            className="input-base w-full pl-9"
          />
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
      {!loading && clients.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-100">
            <Users className="h-7 w-7 text-gray-400" />
          </div>
          <p className="mt-4 text-sm font-bold text-gray-900">尚無個案</p>
          <p className="mt-1 text-xs text-gray-400">完成訪視紀錄後，個案卡片會自動出現</p>
        </div>
      )}

      {/* Client cards grid */}
      {!loading && clients.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map((c) => (
              <button
                key={`${c.case_name}-${c.org_name}`}
                onClick={() =>
                  navigate(
                    `/clients/detail?case_name=${encodeURIComponent(c.case_name)}&org_name=${encodeURIComponent(c.org_name)}`
                  )
                }
                className="group rounded-2xl border border-gray-200/60 bg-white p-5 text-left shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover"
              >
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900 text-primary-500">
                    <Users className="h-4.5 w-4.5" />
                  </div>
                  <p className="text-[15px] font-bold text-gray-900">{c.case_name}</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-400">
                    <MapPin className="h-3.5 w-3.5" />
                    <span>{c.org_name || "—"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-400">
                    <FileText className="h-3.5 w-3.5" />
                    <span>{c.record_count} 筆紀錄</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-400">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>
                      最後訪視：
                      {new Date(c.last_visit_date).toLocaleDateString("zh-TW")}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
