import { useEffect, useState } from "react";
import api from "../../api/axios";
import { useToast } from "../../contexts/ToastContext";
import ConfirmModal from "../../components/ui/ConfirmModal";
import { Plus, Copy, X, Loader2, Pencil, KeyRound, UserX, Trash2 } from "lucide-react";

interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "supervisor";
  is_active: string;
  created_at: string;
  last_record_date: string | null;
  record_count: number;
}

export default function UsersManagementPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [userToDeactivate, setUserToDeactivate] = useState<User | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null);
  const [customPassword, setCustomPassword] = useState("");

  const [newPassword, setNewPassword] = useState("");

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<User[]>("/users");
      setUsers(data);
    } catch {
      showToast("無法載入使用者列表", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDeactivate = async () => {
    if (!userToDeactivate) return;
    try {
      await api.delete(`/users/${userToDeactivate.id}`);
      showToast(`已停用 ${userToDeactivate.name}`);
      fetchUsers();
    } catch {
      showToast("停用失敗", "error");
    } finally {
      setShowDeactivateConfirm(false);
      setUserToDeactivate(null);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUser) return;
    try {
      const payload = customPassword.length >= 8 ? { password: customPassword } : undefined;
      const { data } = await api.post(`/users/${resetPasswordUser.id}/reset-password`, payload);
      setNewPassword(data.new_password);
      setShowResetPasswordModal(false);
      setResetPasswordUser(null);
      setCustomPassword("");
    } catch (e: any) {
      showToast(e.response?.data?.detail || "重設密碼失敗", "error");
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      await api.delete(`/users/${userToDelete.id}/permanent`);
      showToast(`已永久刪除 ${userToDelete.name}`);
      fetchUsers();
    } catch (e: any) {
      showToast(e.response?.data?.detail || "刪除失敗", "error");
    } finally {
      setShowDeleteConfirm(false);
      setUserToDelete(null);
    }
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());

    try {
      if (editingUser) {
        await api.put(`/users/${editingUser.id}`, { name: payload.name, role: payload.role });
        showToast("更新成功");
      } else {
        await api.post("/users", payload);
        showToast("新增成功");
      }
      setShowModal(false);
      fetchUsers();
    } catch (e: any) {
      showToast(e.response?.data?.message || "儲存失敗", "error");
    }
  };

  return (
    <div className="mx-auto max-w-5xl animate-fade-in">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">帳號管理</h2>
        <button
          onClick={() => { setEditingUser(null); setShowModal(true); }}
          className="btn-primary"
        >
          <Plus className="h-4 w-4" />
          新增帳號
        </button>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-surface-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">姓名</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">角色</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-4 py-3">最近活動</th>
                <th className="px-4 py-3">紀錄數</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(u => (
                <tr key={u.id} className="transition-colors hover:bg-surface-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{u.name}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={u.role === 'admin' ? 'badge-purple' : 'badge-blue'}>
                      {u.role === 'admin' ? '管理員' : '督導員'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.is_active ? (
                      <span className="badge-green">啟用中</span>
                    ) : (
                      <span className="badge-red">已停用</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {u.last_record_date ? new Date(u.last_record_date).toLocaleDateString("zh-TW") : "無"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.record_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button 
                         onClick={() => { setEditingUser(u); setShowModal(true); }} 
                         className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-surface-100 hover:text-primary-600"
                         title="編輯"
                      >
                         <Pencil className="h-4 w-4" />
                      </button>
                      <button
                         onClick={() => { setResetPasswordUser(u); setCustomPassword(""); setShowResetPasswordModal(true); }}
                         className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-orange-50 hover:text-orange-600"
                         title="重設密碼"
                      >
                         <KeyRound className="h-4 w-4" />
                      </button>
                      {u.is_active && (
                        <button
                           onClick={() => { setUserToDeactivate(u); setShowDeactivateConfirm(true); }}
                           className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-700"
                           title="停用"
                        >
                           <UserX className="h-4 w-4" />
                        </button>
                      )}
                      {!u.is_active && (
                        <button
                           onClick={() => { setUserToDelete(u); setShowDeleteConfirm(true); }}
                           className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-700"
                           title="永久刪除"
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
      )}

      {newPassword && (
        <div className="mt-4 card border-emerald-200 bg-emerald-50 p-4">
          <p className="text-emerald-800 font-medium">密碼已重設！</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="bg-white px-3 py-1.5 rounded-lg text-lg font-mono text-gray-800 border border-emerald-200">{newPassword}</code>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(newPassword);
                showToast("已複製新密碼");
              }}
              className="btn-primary py-1.5 text-sm"
            >
              <Copy className="h-3.5 w-3.5" />
              複製
            </button>
            <button onClick={() => setNewPassword("")} className="btn-ghost text-sm">
              <X className="h-3.5 w-3.5" />
              關閉
            </button>
          </div>
        </div>
      )}

      {/* User Form Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-modal animate-scale-in">
            <h3 className="text-lg font-bold text-gray-900 mb-4">{editingUser ? "編輯帳號" : "新增帳號"}</h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">姓名</label>
                <input required name="name" defaultValue={editingUser?.name} className="input-base" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                <input required type="email" name="email" defaultValue={editingUser?.email} disabled={!!editingUser} className="input-base disabled:bg-surface-50 disabled:text-gray-500" />
              </div>
              {!editingUser && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">密碼 (最少 8 字元)</label>
                  <input required name="password" minLength={8} className="input-base" />
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">角色</label>
                <select name="role" defaultValue={editingUser?.role || "supervisor"} className="input-base">
                  <option value="supervisor">督導員 (Supervisor)</option>
                  <option value="admin">管理員 (Admin)</option>
                </select>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">取消</button>
                <button type="submit" className="btn-primary">儲存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-modal animate-scale-in">
            <h3 className="text-lg font-bold text-gray-900 mb-1">重設密碼</h3>
            <p className="text-sm text-gray-500 mb-4">為「{resetPasswordUser?.name}」設定新密碼</p>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">自訂密碼 (最少 8 字元)</label>
                <input
                  type="text"
                  value={customPassword}
                  onChange={(e) => setCustomPassword(e.target.value)}
                  placeholder="留空則自動產生隨機密碼"
                  className="input-base"
                />
                {customPassword.length > 0 && customPassword.length < 8 && (
                  <p className="mt-1 text-xs text-red-500">密碼至少需要 8 個字元</p>
                )}
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setShowResetPasswordModal(false); setResetPasswordUser(null); setCustomPassword(""); }}
                  className="btn-secondary"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={customPassword.length > 0 && customPassword.length < 8}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  確認重設
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={showDeactivateConfirm}
        title="停用帳號"
        message={`確定要停用「${userToDeactivate?.name}」的帳號嗎？停用後該帳號將無法登入系統。`}
        confirmLabel="停用"
        danger
        onConfirm={handleDeactivate}
        onCancel={() => setShowDeactivateConfirm(false)}
      />

      <ConfirmModal
        open={showDeleteConfirm}
        title="永久刪除帳號"
        message={`確定要永久刪除「${userToDelete?.name}」的帳號嗎？此操作無法復原。`}
        confirmLabel="永久刪除"
        danger
        onConfirm={handleDeleteUser}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
