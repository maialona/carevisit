import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Shield, Pencil, User as UserIcon, Lock } from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import api from "../../api/axios";

const AVATARS = [
  "cat.png",
  "cat-2.png",
  "koala.png",
  "panda.png",
  "pig.png",
  "puffer-fish.png",
  "rabbit.png",
  "sea-lion.png",
  "tiger.png",
];

type View = "main" | "avatar" | "password";

interface UserDropdownProps {
  name: string;
  role: string;
  onLogout: () => void;
}

export default function UserDropdown({ name, role, onLogout }: UserDropdownProps) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("main");
  const [avatar, setAvatar] = useState<string | null>(user?.avatar || null);

  // password change
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdSuccess, setPwdSuccess] = useState(false);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.avatar) setAvatar(user.avatar);
    AVATARS.forEach((file) => {
      const img = new Image();
      img.src = `/avatars/${file}`;
    });
  }, [user?.avatar]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setView("main");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelectAvatar = async (file: string) => {
    if (!user) return;
    try {
      await api.put("/users/me/avatar", { avatar: file });
      setAvatar(file);
      setUser({ ...user, avatar: file });
      setView("main");
    } catch {
      // silent
    }
  };

  const handleChangePassword = async () => {
    if (!pwdCurrent) { setPwdError("請輸入目前密碼"); return; }
    if (pwdNew.length < 8) { setPwdError("新密碼至少需要 8 個字元"); return; }
    if (pwdNew !== pwdConfirm) { setPwdError("兩次輸入的密碼不一致"); return; }
    setPwdSaving(true);
    setPwdError("");
    try {
      await api.put("/users/me/password", {
        current_password: pwdCurrent,
        new_password: pwdNew,
      });
      setPwdSuccess(true);
      setTimeout(() => {
        setPwdSuccess(false);
        setView("main");
        setPwdCurrent(""); setPwdNew(""); setPwdConfirm("");
      }, 1500);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setPwdError(msg || "修改失敗，請稍後再試");
    } finally {
      setPwdSaving(false);
    }
  };

  const goTo = (v: View) => {
    setView(v);
    setNameError("");
    setPwdError("");
    setPwdSuccess(false);
    if (v === "name") setNameInput(user?.name || "");
    if (v === "password") { setPwdCurrent(""); setPwdNew(""); setPwdConfirm(""); }
  };

  const initial = name.charAt(0).toUpperCase();
  const roleLabel = role === "admin" ? "管理員" : "督導員";

  const avatarElement = avatar ? (
    <img src={`/avatars/${avatar}`} alt="avatar" className="h-8 w-8 rounded-full object-cover" />
  ) : (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-sm font-semibold text-white">
      {initial}
    </div>
  );

  const avatarLarge = avatar ? (
    <img src={`/avatars/${avatar}`} alt="avatar" className="h-10 w-10 rounded-full object-cover" />
  ) : (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-sm font-bold text-white">
      {initial}
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(!open); setView("main"); }}
        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-100"
      >
        {avatarElement}
        <div className="hidden text-left md:block">
          <p className="text-sm font-medium text-gray-800">{user?.name ?? name}</p>
        </div>
        <ChevronDown className="hidden h-4 w-4 text-gray-400 md:block" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-xl border border-gray-200/80 bg-white py-1.5 shadow-modal animate-scale-in">

          {/* ── Main menu ── */}
          {view === "main" && (
            <>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="relative shrink-0">
                  {avatarLarge}
                  <button
                    onClick={(e) => { e.stopPropagation(); goTo("avatar"); }}
                    className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-white shadow-sm transition-transform hover:scale-110"
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-800">{user?.name ?? name}</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Shield className="h-3 w-3 text-gray-400" />
                    <span className="text-xs text-gray-500">{roleLabel}</span>
                  </div>
                </div>
              </div>
              <div className="mx-3 border-t border-gray-100" />
              <button
                onClick={() => goTo("password")}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-600 transition-colors hover:bg-surface-50"
              >
                <Lock className="h-4 w-4" />
                修改密碼
              </button>
              <div className="mx-3 border-t border-gray-100" />
              <button
                onClick={() => { setOpen(false); onLogout(); }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-600 transition-colors hover:bg-surface-50"
              >
                <LogOut className="h-4 w-4" />
                登出
              </button>
            </>
          )}

          {/* ── Avatar picker ── */}
          {view === "avatar" && (
            <>
              <div className="px-4 py-2.5">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">選擇頭像</p>
              </div>
              <div className="grid grid-cols-3 gap-2 px-4 pb-3">
                {AVATARS.map((file) => (
                  <button
                    key={file}
                    onClick={() => handleSelectAvatar(file)}
                    className={`flex items-center justify-center rounded-xl p-1.5 transition-all hover:bg-surface-100 hover:scale-105 ${
                      avatar === file ? "ring-2 ring-primary-500 bg-primary-50" : ""
                    }`}
                  >
                    <img
                      src={`/avatars/${file}`}
                      alt={file.replace(".png", "")}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  </button>
                ))}
              </div>
              <div className="mx-3 border-t border-gray-100" />
              <button
                onClick={() => setView("main")}
                className="flex w-full items-center justify-center px-4 py-2 text-xs font-semibold text-gray-500 transition-colors hover:text-gray-900"
              >
                返回
              </button>
            </>
          )}

          {/* ── Change password ── */}
          {view === "password" && (
            <>
              <div className="px-4 py-2.5">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">修改密碼</p>
              </div>
              <div className="space-y-2 px-4 pb-3">
                <input
                  type="password"
                  value={pwdCurrent}
                  onChange={(e) => { setPwdCurrent(e.target.value); setPwdError(""); }}
                  autoFocus
                  className="input-base w-full text-sm"
                  placeholder="目前密碼"
                />
                <input
                  type="password"
                  value={pwdNew}
                  onChange={(e) => { setPwdNew(e.target.value); setPwdError(""); }}
                  className="input-base w-full text-sm"
                  placeholder="新密碼（至少 8 個字元）"
                />
                <input
                  type="password"
                  value={pwdConfirm}
                  onChange={(e) => { setPwdConfirm(e.target.value); setPwdError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleChangePassword()}
                  className="input-base w-full text-sm"
                  placeholder="確認新密碼"
                />
                {pwdError && <p className="text-xs font-medium text-red-500">{pwdError}</p>}
                {pwdSuccess && <p className="text-xs font-medium text-green-600">密碼已更新！</p>}
              </div>
              <div className="mx-3 border-t border-gray-100" />
              <div className="flex gap-2 px-4 py-2">
                <button
                  onClick={() => setView("main")}
                  className="flex-1 rounded-lg py-1.5 text-xs font-semibold text-gray-500 hover:bg-surface-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleChangePassword}
                  disabled={pwdSaving || pwdSuccess}
                  className="flex-1 rounded-lg bg-gray-900 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  {pwdSaving ? "更新中…" : "確認"}
                </button>
              </div>
            </>
          )}

        </div>
      )}
    </div>
  );
}
