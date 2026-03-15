import { useRef, useState } from "react";
import { X, Loader2, FileSpreadsheet } from "lucide-react";
import { caseProfilesApi } from "../../api/caseProfiles";
import { useToast } from "../../contexts/ToastContext";
import type { ImportPreviewResponse } from "../../types";

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export default function ImportModal({ onClose, onSuccess }: Props) {
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "preview">("upload");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      showToast("請上傳 .xlsx 或 .xls 檔案", "error");
      return;
    }
    setLoading(true);
    try {
      const { data } = await caseProfilesApi.importPreview(file);
      setPreview(data);
      setStep("preview");
    } catch (e: any) {
      showToast(e.response?.data?.message || "解析失敗", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setConfirming(true);
    try {
      const { data } = await caseProfilesApi.importConfirm(preview.rows);
      showToast(`匯入完成：新增 ${data.created} 筆，更新 ${data.updated} 筆`);
      onSuccess();
      onClose();
    } catch (e: any) {
      showToast(e.response?.data?.message || "匯入失敗", "error");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-modal animate-scale-in">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">匯入 Excel</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-surface-100 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === "upload" && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 transition-colors ${
              dragOver ? "border-primary-500 bg-primary-50" : "border-gray-200 hover:border-primary-400 hover:bg-surface-50"
            }`}
          >
            {loading ? (
              <Loader2 className="h-10 w-10 animate-spin text-primary-500" />
            ) : (
              <>
                <FileSpreadsheet className="h-10 w-10 text-gray-400" />
                <p className="text-sm font-medium text-gray-700">拖放或點擊上傳 Excel 檔案</p>
                <p className="text-xs text-gray-400">支援 .xlsx、.xls</p>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-4">
            <div className="flex gap-2 text-sm">
              <span className="rounded-full bg-gray-900 px-3 py-1 text-white font-medium">
                新增 {preview.create_count} 筆
              </span>
              <span className="rounded-full bg-surface-100 border border-gray-200 px-3 py-1 text-gray-600 font-medium">
                更新 {preview.update_count} 筆
              </span>
              {preview.error_rows.length > 0 && (
                <span className="rounded-full bg-red-50 border border-red-100 px-3 py-1 text-red-600 font-medium">
                  錯誤 {preview.error_rows.length} 筆
                </span>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-50">
                  <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-3 py-2">狀態</th>
                    <th className="px-3 py-2">姓名</th>
                    <th className="px-3 py-2">身分證字號</th>
                    <th className="px-3 py-2">居督</th>
                    <th className="px-3 py-2">服務狀態</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-surface-50">
                      <td className="px-3 py-2">
                        {row.action === "create" ? (
                          <span className="inline-flex items-center rounded-full bg-gray-900 px-2.5 py-0.5 text-xs font-medium text-white">新增</span>
                        ) : (
                          <span className="badge-gray">更新</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-800">{row.name}</td>
                      <td className="px-3 py-2 text-gray-600">{row.id_number}</td>
                      <td className="px-3 py-2 text-gray-600">{row.supervisor ?? "-"}</td>
                      <td className="px-3 py-2 text-gray-600">{row.service_status ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.error_rows.length > 0 && (
              <div className="rounded-xl bg-red-50 p-3">
                <p className="text-xs font-medium text-red-700 mb-1">以下列無法匯入：</p>
                {preview.error_rows.map((r, i) => (
                  <p key={i} className="text-xs text-red-600">
                    {r.name || "（無姓名）"} — {r.reason}
                  </p>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button onClick={() => setStep("upload")} className="btn-secondary">重新上傳</button>
              <button onClick={handleConfirm} disabled={confirming} className="btn-primary disabled:opacity-50">
                {confirming && <Loader2 className="h-4 w-4 animate-spin" />}
                確認匯入
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
