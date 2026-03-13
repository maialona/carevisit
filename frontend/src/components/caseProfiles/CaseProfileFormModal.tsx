import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import type { CaseProfile, CaseProfileCreate, CaseProfileUpdate } from "../../types";

interface Props {
  editing: CaseProfile | null;
  onSave: (data: CaseProfileCreate | CaseProfileUpdate) => Promise<void>;
  onClose: () => void;
}

export default function CaseProfileFormModal({ editing, onSave, onClose }: Props) {
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(fd.entries()) as Record<string, string>;

    const payload: Record<string, string | undefined> = {};
    for (const key of Object.keys(raw)) {
      payload[key] = raw[key] || undefined;
    }
    if (!editing) {
      payload.id_number = raw.id_number;
    }

    setSaving(true);
    try {
      await onSave(payload as CaseProfileCreate | CaseProfileUpdate);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-modal animate-scale-in">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">
            {editing ? "編輯個案" : "新增個案"}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-surface-100 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                姓名 <span className="text-red-500">*</span>
              </label>
              <input
                required
                name="name"
                defaultValue={editing?.name}
                className="input-base"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                身分證字號 <span className="text-red-500">*</span>
              </label>
              <input
                required
                name="id_number"
                defaultValue={editing?.id_number}
                disabled={!!editing}
                className="input-base disabled:bg-surface-50 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">居督</label>
              <input name="supervisor" defaultValue={editing?.supervisor ?? ""} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">性別</label>
              <select name="gender" defaultValue={editing?.gender ?? ""} className="input-base">
                <option value="">不指定</option>
                <option value="男">男</option>
                <option value="女">女</option>
                <option value="其他">其他</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">服務狀態</label>
              <input name="service_status" defaultValue={editing?.service_status ?? ""} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">手機</label>
              <input name="phone" defaultValue={editing?.phone ?? ""} className="input-base" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">通訊地址</label>
              <input name="address" defaultValue={editing?.address ?? ""} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">通訊鄉鎮區</label>
              <input name="district" defaultValue={editing?.district ?? ""} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">通訊路段</label>
              <input name="road" defaultValue={editing?.road ?? ""} className="input-base" />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="btn-secondary">取消</button>
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              儲存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
