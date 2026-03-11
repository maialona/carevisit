import { NavLink, Outlet } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useChatStore } from "../store/chatStore";
import UserDropdown from "./ui/UserDropdown";
import ChatPanel, { ChatToggleButton } from "./chat/ChatPanel";
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Bot,
  Settings,
  HeartHandshake,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  icon: LucideIcon;
  to: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: "總覽", icon: LayoutDashboard, to: "/dashboard" },
  { label: "家電訪紀錄", icon: ClipboardList, to: "/records" },
  { label: "個案卡片", icon: Users, to: "/clients" },
  { label: "帳號管理", icon: Settings, to: "/admin/users", adminOnly: true },
];

// Mobile bottom tabs include AI assistant as a toggle
const mobileNavItems: NavItem[] = [
  { label: "總覽", icon: LayoutDashboard, to: "/dashboard" },
  { label: "紀錄", icon: ClipboardList, to: "/records" },
  { label: "個案", icon: Users, to: "/clients" },
];

function SidebarLink({ item, isAdmin }: { item: NavItem; isAdmin: boolean }) {
  if (item.adminOnly && !isAdmin) return null;
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-all ${
          isActive
            ? "bg-primary-500 text-gray-900 shadow-sm"
            : "text-gray-500 hover:bg-surface-100 hover:text-gray-900"
        }`
      }
    >
      <Icon className="h-5 w-5" />
      <span>{item.label}</span>
    </NavLink>
  );
}

function BottomTabLink({ item, isAdmin }: { item: NavItem; isAdmin: boolean }) {
  if (item.adminOnly && !isAdmin) return null;
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition-colors ${
          isActive ? "text-gray-900" : "text-gray-400"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <div className={`rounded-xl p-1.5 transition-colors ${isActive ? "bg-primary-500 text-gray-900" : "bg-transparent text-gray-400"}`}>
            <Icon className="h-5 w-5" />
          </div>
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function Layout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isAdmin = user?.role === "admin";
  const chatOpen = useChatStore((s) => s.open);
  const setChatOpen = useChatStore((s) => s.setOpen);
  const toggleChat = useChatStore((s) => s.toggle);

  return (
    <div className="flex h-screen bg-surface-50">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-col border-r border-gray-200/50 bg-white shadow-sidebar md:flex z-10">
        <div className="flex h-16 items-center gap-3 px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-900">
            <HeartHandshake className="h-5 w-5 text-primary-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 tracking-tight">CareVisit</h1>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider -mt-0.5">長照管理系統</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-4 pt-4">
          {navItems.map((item) => (
            <SidebarLink key={item.to} item={item} isAdmin={isAdmin} />
          ))}
        </nav>

        {/* Sidebar AI assistant button */}
        <div className="px-4 pb-4">
          <button
            onClick={() => setChatOpen(true)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition-all ${
              chatOpen
                ? "bg-gray-900 text-primary-500 font-semibold shadow-md"
                : "font-semibold text-gray-500 hover:bg-surface-100 hover:text-gray-900"
            }`}
          >
            <Bot className="h-5 w-5" />
            <span>AI 助理</span>
          </button>
        </div>

        {/* Sidebar user info */}
        {user && (
          <div className="border-t border-gray-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <SidebarAvatar userId={user.id} name={user.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-gray-900">{user.name}</p>
                <p className="text-xs font-medium text-gray-500">{user.role === "admin" ? "管理員" : "督導員"}</p>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main content area */}
      <div className="flex flex-1 flex-col relative">
        {/* Topbar */}
        <header className="flex h-14 items-center justify-between bg-white px-4 shadow-topbar md:px-6">
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 md:hidden">
            <HeartHandshake className="h-5 w-5 text-primary-600" />
            CareVisit
          </h2>
          <div className="ml-auto flex items-center gap-2">
            <ChatToggleButton onClick={toggleChat} />
            {user && (
              <UserDropdown
                name={user.name}
                role={user.role}
                userId={user.id}
                onLogout={logout}
              />
            )}
          </div>
        </header>

        {/* Content + Chat panel row */}
        <div className="flex flex-1 overflow-hidden">
          {/* Page content */}
          <main className="flex-1 overflow-y-auto p-4 pb-20 md:p-6 md:pb-6">
            <Outlet />
          </main>

          {/* Chat panel (handles desktop inline + mobile overlay internally) */}
          <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
        </div>

        {/* Mobile bottom tab bar */}
        <nav className="fixed inset-x-0 bottom-0 flex border-t border-gray-200/60 bg-white/80 backdrop-blur-lg md:hidden overflow-x-auto safe-area-pb">
          {mobileNavItems.map((item) => (
            <BottomTabLink key={item.to} item={item} isAdmin={isAdmin} />
          ))}
          {/* Mobile AI button in bottom bar */}
          <button
            onClick={() => setChatOpen(true)}
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition-colors ${
              chatOpen ? "text-gray-900" : "text-gray-400"
            }`}
          >
            <div
              className={`rounded-xl p-1.5 transition-colors ${
                chatOpen
                  ? "bg-primary-500 text-gray-900"
                  : "bg-transparent text-gray-400"
              }`}
            >
              <Bot className="h-5 w-5" />
            </div>
            <span>AI 助理</span>
          </button>
          {isAdmin && (
            <BottomTabLink
              item={{ label: "管理", icon: Settings, to: "/admin/users" }}
              isAdmin={true}
            />
          )}
        </nav>
      </div>

    </div>
  );
}

function SidebarAvatar({ userId, name }: { userId: string; name: string }) {
  const avatar = localStorage.getItem(`carevisit_avatar_${userId}`);
  if (avatar) {
    return (
      <img
        src={`/avatars/${avatar}`}
        alt="avatar"
        className="h-10 w-10 rounded-full object-cover shadow-sm"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-500 text-sm font-bold text-gray-900 shadow-sm">
      {name.charAt(0)}
    </div>
  );
}
