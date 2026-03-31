import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Upload, Pencil, Trash2, Loader2, Search, MapPin, X, ClipboardList } from "lucide-react";
import { caseProfilesApi } from "../../api/caseProfiles";
import { useToast } from "../../contexts/ToastContext";
import { usePermission } from "../../hooks/usePermission";
import { useAuthStore } from "../../store/authStore";
import ConfirmModal from "../../components/ui/ConfirmModal";
import CaseProfileFormModal from "../../components/caseProfiles/CaseProfileFormModal";
import ImportModal from "../../components/caseProfiles/ImportModal";
import type { CaseProfile, CaseProfileCreate, CaseProfileUpdate, PaginatedResponse } from "../../types";

export default function CaseProfilesPage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { canCreateCase, canDeleteCase, isSupervisor } = usePermission();
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<PaginatedResponse<CaseProfile> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [myOnly, setMyOnly] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingCase, setEditingCase] = useState<CaseProfile | null>(null);

  const [showImport, setShowImport] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [caseToDelete, setCaseToDelete] = useState<CaseProfile | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [selectMode, setSelectMode] = useState(false);

  const [addressCase, setAddressCase] = useState<CaseProfile | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: res } = await caseProfilesApi.getList({
        page,
        page_size: 20,
        search: search || undefined,
        service_status: statusFilter || undefined,
        supervisor: (isSupervisor && myOnly && user?.name) ? user.name : undefined,
      });
      setData(res);
      setSelected(new Set());
    } catch {
      showToast("無法載入個案列表", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, search, statusFilter, myOnly]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const handleSave = async (payload: CaseProfileCreate | CaseProfileUpdate) => {
    try {
      if (editingCase) {
        await caseProfilesApi.update(editingCase.id, payload as CaseProfileUpdate);
        showToast("更新成功");
      } else {
        await caseProfilesApi.create(payload as CaseProfileCreate);
        showToast("新增成功");
      }
      setShowForm(false);
      setEditingCase(null);
      fetchData();
    } catch (e: any) {
      showToast(e.response?.data?.message || "儲存失敗", "error");
      throw e;
    }
  };

  const handleDelete = async () => {
    if (!caseToDelete) return;
    try {
      await caseProfilesApi.delete(caseToDelete.id);
      showToast("已刪除");
      fetchData();
    } catch {
      showToast("刪除失敗", "error");
    } finally {
      setShowDeleteConfirm(false);
      setCaseToDelete(null);
    }
  };

  const handleBatchDelete = async () => {
    try {
      const { data: res } = await caseProfilesApi.batchDelete(Array.from(selected));
      showToast(`已刪除 ${res.deleted} 筆個案`);
      fetchData();
    } catch {
      showToast("批次刪除失敗", "error");
    } finally {
      setShowBatchDeleteConfirm(false);
    }
  };

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((c) => selected.has(c.id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((c) => c.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-6xl animate-fade-in">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900">個案管理</h2>
        <div className="flex gap-2">
          {canDeleteCase && selectMode && someSelected && (
            <button
              onClick={() => setShowBatchDeleteConfirm(true)}
              className="btn-secondary text-red-600 hover:bg-red-50 hover:border-red-200"
            >
              <Trash2 className="h-4 w-4" />
              刪除已選 ({selected.size})
            </button>
          )}
          {canDeleteCase && (
            <button
              onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}
              className={`btn-secondary ${selectMode ? "bg-surface-100 text-gray-900" : ""}`}
              title="批次刪除"
            >
              <Trash2 className="h-4 w-4" />
              批次刪除
            </button>
          )}
          {canCreateCase && (
            <button onClick={() => setShowImport(true)} className="btn-secondary">
              <Upload className="h-4 w-4" />
              匯入 Excel
            </button>
          )}
          {canCreateCase && (
            <button
              onClick={() => { setEditingCase(null); setShowForm(true); }}
              className="btn-primary"
            >
              <Plus className="h-4 w-4" />
              新增個案
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <form onSubmit={handleSearch} className="flex flex-1 min-w-48 items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="搜尋姓名或身分證字號"
              className="input-base pl-9"
            />
          </div>
          <button type="submit" className="btn-secondary shrink-0">搜尋</button>
        </form>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="input-base w-auto"
        >
          <option value="">全部狀態</option>
          <option value="服務中">服務中</option>
          <option value="暫停服務">暫停服務</option>
          <option value="結案">結案</option>
        </select>
        {isSupervisor && (
          <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shrink-0">
            <button
              onClick={() => { setMyOnly(false); setPage(1); }}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-all duration-200 ${
                !myOnly ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:text-gray-800 hover:bg-surface-100"
              }`}
            >
              全部個案
            </button>
            <button
              onClick={() => { setMyOnly(true); setPage(1); }}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-all duration-200 ${
                myOnly ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:text-gray-800 hover:bg-surface-100"
              }`}
            >
              我的個案
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        </div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-surface-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {selectMode && (
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="h-4 w-4 rounded border-gray-300 accent-gray-900 cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 min-w-[5rem]">姓名</th>
                  <th className="px-4 py-3 min-w-[8rem]">身分證字號</th>
                  <th className="px-4 py-3 min-w-[5rem]">居督</th>
                  <th className="px-4 py-3 w-12 whitespace-nowrap">性別</th>
                  <th className="px-4 py-3 min-w-[5.5rem]">服務狀態</th>
                  <th className="px-4 py-3 min-w-[7rem]">手機</th>
                  <th className="px-4 py-3 w-16">地址</th>
                  <th className="px-4 py-3 min-w-[6rem]">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.length === 0 && (
                  <tr>
                    <td colSpan={selectMode ? 9 : 8} className="px-4 py-8 text-center text-gray-400">
                      尚無個案資料
                    </td>
                  </tr>
                )}
                {items.map((c) => (
                  <tr
                    key={c.id}
                    className={`transition-colors hover:bg-surface-50 ${selected.has(c.id) ? "bg-primary-50" : ""}`}
                  >
                    {selectMode && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleOne(c.id)}
                          className="h-4 w-4 rounded border-gray-300 accent-gray-900 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{c.name}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.id_number}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.supervisor ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.gender ?? "-"}</td>
                    <td className="px-4 py-3">
                      {c.service_status ? (
                        <span className={`whitespace-nowrap ${
                          c.service_status === "服務中" ? "badge-green" :
                          c.service_status === "暫停服務" ? "badge-yellow" :
                          c.service_status === "結案" ? "badge-red" :
                          "badge-blue"
                        }`}>{c.service_status}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.phone ?? "-"}</td>
                    <td className="px-4 py-3">
                      {(c.address || c.district || c.road) ? (
                        <button
                          onClick={() => setAddressCase(c)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-surface-100 hover:text-primary-600"
                          title="查看地址"
                        >
                          <MapPin className="h-4 w-4" />
                        </button>
                      ) : (
                        <span className="text-gray-300 px-2">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/records?case_name=${encodeURIComponent(c.name)}`)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-surface-100 hover:text-primary-600"
                          title="查看紀錄"
                        >
                          <ClipboardList className="h-4 w-4" />
                        </button>
                        {canCreateCase && (
                          <button
                            onClick={() => { setEditingCase(c); setShowForm(true); }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-surface-100 hover:text-primary-600"
                            title="編輯"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {canDeleteCase && (
                          <button
                            onClick={() => { setCaseToDelete(c); setShowDeleteConfirm(true); }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-700"
                            title="刪除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data && data.total_pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
              <span>共 {data.total} 筆</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="btn-secondary py-1 px-3 disabled:opacity-40"
                >
                  上一頁
                </button>
                <span className="px-2 py-1">
                  {page} / {data.total_pages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}
                  disabled={page >= data.total_pages}
                  className="btn-secondary py-1 px-3 disabled:opacity-40"
                >
                  下一頁
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showForm && (
        <CaseProfileFormModal
          editing={editingCase}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingCase(null); }}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onSuccess={fetchData}
        />
      )}

      <ConfirmModal
        open={showDeleteConfirm}
        title="刪除個案"
        message={`確定要刪除「${caseToDelete?.name}」的個案資料嗎？此操作無法復原。`}
        confirmLabel="刪除"
        danger
        onConfirm={handleDelete}
        onCancel={() => { setShowDeleteConfirm(false); setCaseToDelete(null); }}
      />

      {addressCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-modal animate-scale-in">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary-600" />
                <h3 className="text-base font-bold text-gray-900">{addressCase.name} 的地址</h3>
              </div>
              <button onClick={() => setAddressCase(null)} className="rounded-lg p-1 text-gray-400 hover:bg-surface-100 hover:text-gray-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <dl className="space-y-3 text-sm">
              {addressCase.address && (
                <div>
                  <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-0.5">通訊地址</dt>
                  <dd className="text-gray-800">{addressCase.address}</dd>
                </div>
              )}
              {addressCase.district && (
                <div>
                  <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-0.5">通訊鄉鎮區</dt>
                  <dd className="text-gray-800">{addressCase.district}</dd>
                </div>
              )}
              {addressCase.road && (
                <div>
                  <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-0.5">通訊路段</dt>
                  <dd className="text-gray-800">{addressCase.road}</dd>
                </div>
              )}
            </dl>
            <button onClick={() => setAddressCase(null)} className="btn-secondary mt-5 w-full">關閉</button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={showBatchDeleteConfirm}
        title="批次刪除個案"
        message={`確定要刪除已選取的 ${selected.size} 筆個案嗎？此操作無法復原。`}
        confirmLabel="全部刪除"
        danger
        onConfirm={handleBatchDelete}
        onCancel={() => setShowBatchDeleteConfirm(false)}
      />
    </div>
  );
}
