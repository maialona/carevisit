import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Shield, Pencil } from "lucide-react";
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

interface UserDropdownProps {
  name: string;
  role: string;
  onLogout: () => void;
}

export default function UserDropdown({ name, role, onLogout }: UserDropdownProps) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(user?.avatar || null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.avatar) {
      setAvatar(user.avatar);
    }

    // Preload avatars to avoid rendering delay
    AVATARS.forEach((file) => {
      const img = new Image();
      img.src = `/avatars/${file}`;
    });
  }, [user?.avatar]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPicking(false);
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
      setPicking(false);
    } catch (error) {
      console.error("Failed to update avatar", error);
    }
  };

  const initial = name.charAt(0).toUpperCase();
  const roleLabel = role === "admin" ? "管理員" : "督導員";

  const avatarElement = avatar ? (
    <img
      src={`/avatars/${avatar}`}
      alt="avatar"
      className="h-8 w-8 rounded-full object-cover"
    />
  ) : (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-sm font-semibold text-white">
      {initial}
    </div>
  );

  const avatarLarge = avatar ? (
    <img
      src={`/avatars/${avatar}`}
      alt="avatar"
      className="h-10 w-10 rounded-full object-cover"
    />
  ) : (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-sm font-bold text-white">
      {initial}
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(!open); setPicking(false); }}
        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-100"
      >
        {avatarElement}
        <div className="hidden text-left md:block">
          <p className="text-sm font-medium text-gray-800">{name}</p>
        </div>
        <ChevronDown className="hidden h-4 w-4 text-gray-400 md:block" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-xl border border-gray-200/80 bg-white py-1.5 shadow-modal animate-scale-in">
          {!picking ? (
            <>
              {/* User info */}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="relative shrink-0">
                  {avatarLarge}
                  <button
                    onClick={(e) => { e.stopPropagation(); setPicking(true); }}
                    className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-white shadow-sm transition-transform hover:scale-110"
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-800">{name}</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Shield className="h-3 w-3 text-gray-400" />
                    <span className="text-xs text-gray-500">{roleLabel}</span>
                  </div>
                </div>
              </div>
              <div className="mx-3 border-t border-gray-100" />
              <button
                onClick={() => { setOpen(false); onLogout(); }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-600 transition-colors hover:bg-surface-50"
              >
                <LogOut className="h-4 w-4" />
                登出
              </button>
            </>
          ) : (
            <>
              {/* Avatar picker */}
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
                onClick={() => setPicking(false)}
                className="flex w-full items-center justify-center px-4 py-2 text-xs font-semibold text-gray-500 transition-colors hover:text-gray-900"
              >
                返回
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
