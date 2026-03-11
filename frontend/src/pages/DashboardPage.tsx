import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useChatStore } from "../store/chatStore";
import { statsApi, type DashboardStats } from "../api/stats";
import {
  Home,
  Phone,
  FileEdit,
  Plus,
  ClipboardList,
  ArrowRight,
  TrendingUp,
  Calendar,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const openChat = useChatStore((s) => s.setOpen);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    statsApi.getDashboardStats()
      .then(setStats)
      .catch((err) => console.error("Failed to load dashboard stats", err))
      .finally(() => setLoadingStats(false));
  }, []);

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "早安" : hour < 18 ? "午安" : "晚安";

  return (
    <div className="animate-fade-in space-y-6">
      {/* Hero greeting banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gray-900 p-6 md:p-8 text-white shadow-md">
        <div className="relative z-10">
          <p className="text-primary-500 text-sm font-semibold tracking-wider">{greeting}，</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">{user?.name || "使用者"}</h2>
          <p className="mt-2 text-sm text-gray-300 font-medium leading-relaxed">
            今天也辛苦了！以下是你的工作概況。
          </p>
        </div>

      </div>

      {/* Bento grid stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {/* Home visits */}
        <BentoStat
          icon={Home}
          value={stats?.home_visits_this_month ?? 0}
          isLoading={loadingStats}
          label="本月家訪"
          className="col-span-1"
        />
        <BentoStat
          icon={Phone}
          value={stats?.phone_visits_this_month ?? 0}
          isLoading={loadingStats}
          label="本月電訪"
          className="col-span-1"
        />
        <BentoStat
          icon={FileEdit}
          value={stats?.pending_records ?? 0}
          isLoading={loadingStats}
          label="待完成紀錄"
          highlight
          className="col-span-1"
        />
        <BentoStat
          icon={ClipboardList}
          value={stats?.total_records ?? 0}
          isLoading={loadingStats}
          label="總紀錄數"
          className="col-span-1"
        />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <QuickAction
          icon={Plus}
          title="新增紀錄"
          desc="建立家訪或電訪紀錄"
          onClick={() => navigate("/records/new")}
        />
        <QuickAction
          icon={Sparkles}
          title="AI 助理"
          desc="查詢資料與統計分析"
          highlight
          onClick={() => openChat(true)}
        />
      </div>

      {/* Activity timeline hint */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-100">
              <Calendar className="h-4 w-4 text-gray-900" />
            </div>
            <h3 className="text-base font-bold text-gray-900">近期活動</h3>
          </div>
          <button
            onClick={() => navigate("/records")}
            className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-900 transition-colors uppercase tracking-wider"
          >
            查看全部
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 flex items-center justify-center rounded-xl border border-dashed border-gray-200 bg-surface-50 py-10 text-sm font-medium text-gray-400">
          紀錄將在此顯示最近的家電訪活動
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function BentoStat({
  icon: Icon,
  value,
  label,
  trend,
  highlight,
  isLoading,
  className = "",
}: {
  icon: LucideIcon;
  value: number;
  label: string;
  trend?: string;
  highlight?: boolean;
  isLoading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`group relative card card-hover overflow-hidden p-5 ${className} ${
        highlight ? "ring-2 ring-gray-900" : ""
      }`}
    >
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${highlight ? 'bg-primary-500 text-gray-900 shadow-sm' : 'bg-surface-100 text-gray-900'}`}>
            <Icon className="h-5 w-5" />
          </div>
          {trend && !isLoading && (
            <span className="flex items-center gap-1 rounded-full bg-gray-900 px-2.5 py-1 text-[11px] font-bold tracking-wide text-primary-500">
              <TrendingUp className="h-3 w-3" />
              {trend}
            </span>
          )}
        </div>
        {isLoading ? (
           <div className="mt-4 h-9 w-16 animate-pulse rounded bg-gray-200" />
        ) : (
           <p className="mt-4 text-3xl font-black tracking-tight text-gray-900">
             {value}
           </p>
        )}
        <p className="mt-1 text-sm font-semibold text-gray-500">{label}</p>
      </div>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  title,
  desc,
  highlight,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  highlight?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full flex-col items-start gap-4 rounded-2xl border p-5 text-left transition-all duration-300 hover:-translate-y-1 ${
        highlight
          ? "border-gray-900 bg-gray-900 text-white shadow-md"
          : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-card-hover"
      }`}
    >
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110 ${
          highlight ? "bg-primary-500 text-gray-900" : "bg-surface-100 text-gray-900"
        }`}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <p className={`text-base font-bold ${highlight ? "text-white" : "text-gray-900"}`}>
            {title}
          </p>
          <ArrowRight className={`h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 ${highlight ? "text-primary-500" : "text-gray-400"}`} />
        </div>
        <p className={`mt-1 text-xs font-medium ${highlight ? "text-gray-400" : "text-gray-500"}`}>
          {desc}
        </p>
      </div>
    </button>
  );
}
