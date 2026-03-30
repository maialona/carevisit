import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Navigation,
  Route,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { DirectionsRenderer, GoogleMap, useJsApiLoader } from "@react-google-maps/api";
import {
  DEFAULT_ORIGIN,
  RouteResult,
  RouteStop,
  ThinkingLog,
  streamManualRoutePlan,
  streamRoutePlan,
} from "../api/routePlanner";
import { caseProfilesApi } from "../api/caseProfiles";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function stepColor(step: ThinkingLog["step"]) {
  if (step === "ACT") return "bg-blue-100 text-blue-700";
  if (step === "OBSERVE") return "bg-purple-100 text-purple-700";
  return "bg-amber-100 text-amber-700";
}

function ComplianceBadge({ status }: { status: string }) {
  if (status === "overdue")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
        <AlertTriangle className="h-3 w-3" />
        逾期
      </span>
    );
  if (status === "due_soon")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-700">
        <Clock className="h-3 w-3" />
        即將到期
      </span>
    );
  return null;
}

// ─── Stop card ────────────────────────────────────────────────────────────────

function StopCard({ stop, isLast }: { stop: RouteStop; isLast: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white shadow">
          {stop.order}
        </div>
        {!isLast && <div className="mt-1 w-0.5 flex-1 bg-gray-200" />}
      </div>
      <div className={`min-w-0 flex-1 rounded-xl border border-gray-100 bg-white p-4 shadow-sm ${!isLast ? "mb-3" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="text-sm font-bold text-gray-900">{stop.name}</span>
          <ComplianceBadge status={stop.compliance} />
        </div>
        <div className="mt-1.5 flex items-start gap-1 text-xs text-gray-500">
          <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
          <span className="leading-relaxed">
            {stop.formatted_address || stop.address || "（地址不詳）"}
          </span>
        </div>
        {stop.duration_from_prev_min != null && (
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {stop.duration_from_prev_min} 分鐘
            </span>
            {stop.distance_from_prev_km != null && (
              <span className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3" />
                {stop.distance_from_prev_km} 公里
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Case search & selection (manual mode) ────────────────────────────────────

interface SelectedCase {
  id: string;
  name: string;
}

function CaseSelector({
  selected,
  onAdd,
  onRemove,
  disabled,
}: {
  selected: SelectedCase[];
  onAdd: (c: SelectedCase) => void;
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SelectedCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleInput = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await caseProfilesApi.searchCases(val);
        const filtered = res.data.filter((s) => !selected.some((sel) => sel.id === s.id));
        setSuggestions(filtered);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const pick = (c: SelectedCase) => {
    onAdd(c);
    setQuery("");
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div ref={wrapperRef} className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            disabled={disabled || selected.length >= 23}
            placeholder={selected.length >= 23 ? "已達上限（23 位）" : "搜尋個案姓名…"}
            className="w-full rounded-xl border border-gray-200 bg-surface-50 py-2.5 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-50"
          />
          {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />}
        </div>

        {open && suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                className="flex w-full items-center px-4 py-2.5 text-left text-sm text-gray-800 hover:bg-surface-50"
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {open && !loading && suggestions.length === 0 && query.trim() && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-400 shadow-lg">
            查無符合個案
          </div>
        )}
      </div>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-800"
            >
              {c.name}
              <button
                onClick={() => onRemove(c.id)}
                disabled={disabled}
                className="ml-0.5 rounded-full text-gray-400 transition hover:text-gray-700 disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {selected.length === 0 && (
        <p className="text-xs text-gray-400">尚未選取任何個案</p>
      )}
    </div>
  );
}

// ─── Route map ────────────────────────────────────────────────────────────────

const MAP_CONTAINER_STYLE = { width: "100%", height: "400px" };

function RouteMapView({ result }: { result: RouteResult }) {
  const stopsWithCoords = result.route.filter((s) => s.lat != null && s.lng != null);
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ?? "";

  const { isLoaded } = useJsApiLoader({
    id: "carevisit-google-maps",
    googleMapsApiKey: apiKey,
  });

  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const routeKey = result.route.map((s) => s.case_id).join(",");

  useEffect(() => {
    if (!isLoaded || stopsWithCoords.length === 0) return;
    setDirections(null);
    const service = new google.maps.DirectionsService();
    const waypoints = stopsWithCoords.map((s) => ({
      location: new google.maps.LatLng(s.lat!, s.lng!),
      stopover: true,
    }));
    service.route(
      {
        origin: result.origin,
        destination: result.origin,
        waypoints,
        optimizeWaypoints: false,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (res, status) => {
        if (status === google.maps.DirectionsStatus.OK && res) setDirections(res);
      },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, routeKey]);

  if (!apiKey || stopsWithCoords.length === 0) return null;

  if (!isLoaded) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-2xl border border-gray-100 bg-surface-50 shadow-sm">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const midIdx = Math.floor(stopsWithCoords.length / 2);
  const center = { lat: stopsWithCoords[midIdx].lat!, lng: stopsWithCoords[midIdx].lng! };

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 shadow-sm">
      <GoogleMap
        mapContainerStyle={MAP_CONTAINER_STYLE}
        center={center}
        zoom={13}
        options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false }}
      >
        {directions && <DirectionsRenderer directions={directions} />}
      </GoogleMap>
    </div>
  );
}

// ─── Result section (shared) ──────────────────────────────────────────────────

function RouteResultView({ result }: { result: RouteResult }) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">{result.summary}</p>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-gray-400" />
                起點：{result.origin}
              </span>
              {result.total_duration_min > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-gray-400" />
                  預計 {result.total_duration_min} 分鐘
                </span>
              )}
              {result.total_distance_km > 0 && (
                <span className="flex items-center gap-1">
                  <Route className="h-3.5 w-3.5 text-gray-400" />
                  {result.total_distance_km} 公里
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {result.route.length} 個停靠點
          </div>
        </div>

        {result.warnings.length > 0 && (
          <div className="mt-3 space-y-1">
            {result.warnings.map((w, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-yellow-50 px-3 py-1.5 text-xs text-yellow-700">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                {w}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Map */}
      <RouteMapView result={result} />

      {/* Stops */}
      {result.route.length > 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-surface-50 p-5 shadow-sm">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-400">
            建議訪視順序
          </h2>
          {result.route.map((stop, i) => (
            <StopCard key={stop.case_id} stop={stop} isLast={i === result.route.length - 1} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-400 shadow-sm">
          無可規劃的停靠點
        </div>
      )}

      {/* Missing cases */}
      {result.missing_cases.length > 0 && (
        <div className="rounded-2xl border border-orange-100 bg-orange-50 p-5 shadow-sm">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-orange-500">
            未排入路線（地址問題）
          </h2>
          <div className="space-y-2">
            {result.missing_cases.map((c, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-800">{c.name}</span>
                  <span className="text-xs text-gray-400">{c.address || "（無地址）"}</span>
                </div>
                <ComplianceBadge status={c.compliance} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Mode = "auto" | "manual";

export default function RoutePlannerPage() {
  const [mode, setMode] = useState<Mode>("auto");

  // Auto mode state
  const [targetDate, setTargetDate] = useState(todayStr());

  // Manual mode state
  const [selectedCases, setSelectedCases] = useState<SelectedCase[]>([]);

  // Shared state
  const [origin, setOrigin] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<ThinkingLog[]>([]);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    abortRef.current?.abort();
    setIsRunning(false);
    setLogs([]);
    setResult(null);
    setErrorMsg(null);
  };

  const switchMode = (m: Mode) => {
    reset();
    setMode(m);
  };

  const callbacks = {
    onThinking: (log: ThinkingLog) => setLogs((prev) => [...prev, log]),
    onResult: (r: RouteResult) => setResult(r),
    onDone: () => setIsRunning(false),
    onError: (msg: string) => setErrorMsg(msg),
  };

  const start = () => {
    if (isRunning) return;
    setIsRunning(true);
    setLogs([]);
    setResult(null);
    setErrorMsg(null);

    if (mode === "auto") {
      abortRef.current = streamRoutePlan(
        targetDate,
        origin,
        callbacks.onThinking,
        callbacks.onResult,
        callbacks.onDone,
        callbacks.onError,
      );
    } else {
      abortRef.current = streamManualRoutePlan(
        selectedCases.map((c) => c.id),
        origin,
        callbacks.onThinking,
        callbacks.onResult,
        callbacks.onDone,
        callbacks.onError,
      );
    }
  };

  const canStart =
    !isRunning &&
    (mode === "auto" ? !!targetDate : selectedCases.length > 0);

  const hasResult = result !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
          <Route className="h-5 w-5 text-primary-500" />
          路線規劃
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Agent 自動查詢需訪視個案，或由你手動選擇，規劃最佳家訪路線
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex rounded-xl border border-gray-200 bg-surface-50 p-1">
        {(["auto", "manual"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            disabled={isRunning}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
              mode === m
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700 disabled:opacity-50"
            }`}
          >
            {m === "auto" ? "自動（依排程）" : "手動選案"}
          </button>
        ))}
      </div>

      {/* Form */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="space-y-4">
          {/* Auto: date picker */}
          {mode === "auto" && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">規劃日期</label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                disabled={isRunning}
                className="w-full rounded-xl border border-gray-200 bg-surface-50 px-3 py-2.5 text-sm text-gray-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-50"
              />
            </div>
          )}

          {/* Manual: case selector */}
          {mode === "manual" && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                選擇個案
                <span className="ml-1.5 font-normal text-gray-400">（最多 23 位）</span>
              </label>
              <CaseSelector
                selected={selectedCases}
                onAdd={(c) => setSelectedCases((prev) => [...prev, c])}
                onRemove={(id) => setSelectedCases((prev) => prev.filter((c) => c.id !== id))}
                disabled={isRunning}
              />
            </div>
          )}

          {/* Origin address (shared) */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-gray-600">出發地址</label>
            <input
              type="text"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              disabled={isRunning}
              placeholder={DEFAULT_ORIGIN}
              className="w-full rounded-xl border border-gray-200 bg-surface-50 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={start}
            disabled={!canStart}
            className="flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-primary-400 shadow-sm transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
            {isRunning ? "規劃中…" : "開始規劃"}
          </button>

          {(hasResult || logs.length > 0) && !isRunning && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500 transition hover:bg-surface-50"
            >
              <RotateCcw className="h-4 w-4" />
              重置
            </button>
          )}
        </div>
      </div>

      {/* Thinking log */}
      {logs.length > 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-400">
            Agent 思考過程
          </h2>
          <div className="space-y-2">
            {logs.map((log, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm">
                <span className={`mt-0.5 flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${stepColor(log.step)}`}>
                  {log.step}
                </span>
                <span className="leading-relaxed text-gray-700">{log.content}</span>
              </div>
            ))}
            {isRunning && (
              <div className="flex items-center gap-2 pt-1 text-xs text-gray-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                處理中…
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* Result */}
      {hasResult && !isRunning && <RouteResultView result={result!} />}
    </div>
  );
}
