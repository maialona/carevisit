import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useHotkeys } from "react-hotkeys-hook";
import { recordsApi } from "../api/records";
import { aiApi } from "../api/ai";
import { caseProfilesApi } from "../api/caseProfiles";
import { useDebounce } from "../hooks/useDebounce";
import { useToast } from "../contexts/ToastContext";
import VoiceRecorder from "../components/records/VoiceRecorder";
import PhotoUploader from "../components/records/PhotoUploader";
import RichEditor from "../components/records/RichEditor";
import DiffView from "../components/records/DiffView";
import SectionRefiner from "../components/records/SectionRefiner";
import ConfirmModal from "../components/ui/ConfirmModal";
import ExportDropdown from "../components/records/ExportDropdown";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { format } from "date-fns";
import {
  Home,
  Phone,
  Sparkles,
  Save,
  CheckCircle,
  Copy,
  Check,
  Loader2,
  Keyboard,
  AlertTriangle,
  X,
  GitCompareArrows,
  Columns2,
  PenLine,
} from "lucide-react";
import type { CaseProfile, GapItem, ToneStyle, VisitRecord } from "../types";

type VisitType = "home" | "phone";
type OutputFormat = "bullet" | "narrative";

export default function RecordFormPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isEdit = !!id;

  // --- State ---
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);

  // Step 1
  const [caseName, setCaseName] = useState(searchParams.get("case_name") || "");
  const [orgName, setOrgName] = useState(searchParams.get("org_name") || "");
  const [visitType, setVisitType] = useState<VisitType>(
    (searchParams.get("visit_type") as VisitType) || "home"
  );
  const [caseProfileId, setCaseProfileId] = useState<string | null>(
    searchParams.get("case_profile_id") || null
  );
  const [caseSearch, setCaseSearch] = useState(searchParams.get("case_name") || "");
  const [caseDropdownResults, setCaseDropdownResults] = useState<CaseProfile[]>([]);
  const [showCaseDropdown, setShowCaseDropdown] = useState(false);
  const [caseSearchLoading, setCaseSearchLoading] = useState(false);
  const caseDropdownRef = useRef<HTMLDivElement>(null);
  const debouncedCaseSearch = useDebounce(caseSearch, 300);
  const [visitDate, setVisitDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  // Step 2
  const [rawInput, setRawInput] = useState("");

  // Step 2 - gaps
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [checkingGaps, setCheckingGaps] = useState(false);
  const [gapsDismissed, setGapsDismissed] = useState(false);
  const gapsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 3
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(
    "bullet",
  );
  const [tone, setTone] = useState<ToneStyle>(() => {
    return (localStorage.getItem("carevisit_tone") as ToneStyle) || "professional";
  });
  const [autoRefine, setAutoRefine] = useState(() => {
    return localStorage.getItem("carevisit_auto_refine") === "true";
  });
  const [refinedContent, setRefinedContent] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const streamControllerRef = useRef<AbortController | null>(null);
  const [copied, setCopied] = useState(false);
  const [showFormatConfirm, setShowFormatConfirm] = useState(false);
  const pendingFormatRef = useRef<OutputFormat | null>(null);

  // View mode: "edit" = RichEditor, "diff" = diff comparison, "section" = paragraph-level refine
  type ViewMode = "edit" | "diff" | "section";
  const [viewMode, setViewMode] = useState<ViewMode>("edit");


  // Load existing record for edit
  useEffect(() => {
    if (!id) return;
    recordsApi
      .getById(id)
      .then((r: VisitRecord) => {
        setCaseName(r.case_name);
        setCaseSearch(r.case_name);
        setOrgName(r.org_name);
        setVisitType(r.visit_type);
        setVisitDate(r.visit_date.slice(0, 10));
        setRawInput(r.raw_input);
        setRefinedContent(r.refined_content);
        setOutputFormat(r.output_format);
        setAutoRefine(r.auto_refine);
        if (r.case_profile_id) setCaseProfileId(r.case_profile_id);
      })
      .catch(() => showToast("載入紀錄失敗", "error"))
      .finally(() => setLoading(false));
  }, [id, showToast]);

  // Case profile search
  useEffect(() => {
    if (isEdit || !debouncedCaseSearch.trim() || caseProfileId) return;
    setCaseSearchLoading(true);
    caseProfilesApi.getList({ search: debouncedCaseSearch, page_size: 10 })
      .then(({ data }) => {
        setCaseDropdownResults(data.items);
        setShowCaseDropdown(data.items.length > 0);
      })
      .catch(() => {})
      .finally(() => setCaseSearchLoading(false));
  }, [debouncedCaseSearch, isEdit, caseProfileId]);

  // Click outside to close dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (caseDropdownRef.current && !caseDropdownRef.current.contains(e.target as Node)) {
        setShowCaseDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Persist autoRefine + tone to localStorage
  useEffect(() => {
    localStorage.setItem("carevisit_auto_refine", String(autoRefine));
  }, [autoRefine]);
  useEffect(() => {
    localStorage.setItem("carevisit_tone", tone);
  }, [tone]);

  // Cleanup stream + gaps timer on unmount
  useEffect(() => {
    return () => {
      streamControllerRef.current?.abort();
      if (gapsTimerRef.current) clearTimeout(gapsTimerRef.current);
    };
  }, []);

  // --- Check gaps ---
  const doCheckGaps = useCallback(async () => {
    if (!rawInput.trim() || rawInput.trim().length < 20) {
      setGaps([]);
      return;
    }
    setCheckingGaps(true);
    try {
      const result = await aiApi.checkGaps(rawInput, visitType);
      setGaps(result.gaps);
      setGapsDismissed(false);
    } catch {
      // Silently fail - gaps check is non-critical
    } finally {
      setCheckingGaps(false);
    }
  }, [rawInput, visitType]);

  // --- AI refine (streaming) ---
  const doRefine = useCallback((formatOverride?: OutputFormat) => {
    if (!rawInput.trim() || refining) return;

    // Abort any previous stream
    streamControllerRef.current?.abort();

    setRefining(true);
    setIsStreaming(true);
    setStreamingContent("");
    setRefinedContent("");

    const controller = aiApi.refineStream(
      {
        text: rawInput,
        format: formatOverride || outputFormat,
        visit_type: visitType,
        tone,
        record_id: id,
      },
      // onChunk
      (text) => {
        setStreamingContent((prev) => prev + text);
      },
      // onDone
      (fullText, tokensUsed) => {
        setRefinedContent(fullText);
        setStreamingContent("");
        setIsStreaming(false);
        setRefining(false);
        showToast(`潤飾完成（使用 ${tokensUsed} tokens）`);
      },
      // onError
      (message) => {
        setIsStreaming(false);
        setRefining(false);
        setStreamingContent("");
        showToast(message || "AI 潤飾失敗，請重試", "error");
      },
    );

    streamControllerRef.current = controller;
  }, [rawInput, outputFormat, visitType, tone, id, refining, showToast]);

  // Auto-refine on blur + check gaps with debounce
  const handleRawBlur = useCallback(() => {
    if (autoRefine && rawInput.trim()) {
      doRefine();
    }
    // Debounced gap check
    if (gapsTimerRef.current) clearTimeout(gapsTimerRef.current);
    gapsTimerRef.current = setTimeout(() => {
      doCheckGaps();
    }, 500);
  }, [autoRefine, rawInput, doRefine, doCheckGaps]);

  // Format switch with confirmation
  const handleFormatSwitch = (fmt: OutputFormat) => {
    if (fmt === outputFormat) return;
    if (refinedContent.trim()) {
      pendingFormatRef.current = fmt;
      setShowFormatConfirm(true);
    } else {
      setOutputFormat(fmt);
    }
  };

  const confirmFormatSwitch = () => {
    const nextFmt = pendingFormatRef.current;
    if (nextFmt) {
      setOutputFormat(nextFmt);
      pendingFormatRef.current = null;
      setShowFormatConfirm(false);
      // Pass the new format directly because outputFormat in this closure is still the old one
      setTimeout(() => doRefine(nextFmt), 50);
    }
  };

  // --- Save ---
  const save = useCallback(
    async (status: "draft" | "completed") => {
      if (!isEdit && !caseProfileId) {
        showToast("請從下拉清單選取個案", "error");
        return;
      }
      if (!caseName || !orgName) {
        showToast("請填寫個案姓名與居住區域", "error");
        return;
      }
      setSaving(true);
      try {
        if (isEdit && id) {
          await recordsApi.update(id, {
            visit_date: visitDate,
            raw_input: rawInput,
            refined_content: refinedContent,
            output_format: outputFormat,
            auto_refine: autoRefine,
            status,
          });
          showToast(status === "completed" ? "紀錄已完成" : "草稿已儲存");
          navigate(`/records`);
        } else {
          const created = await recordsApi.create({
            case_name: caseName,
            org_name: orgName,
            visit_type: visitType,
            visit_date: visitDate,
            raw_input: rawInput,
            refined_content: refinedContent,
            output_format: outputFormat,
            auto_refine: autoRefine,
            status,
            ...(caseProfileId ? { case_profile_id: caseProfileId } : {}),
          });
          showToast(status === "completed" ? "紀錄已完成" : "草稿已儲存");
          navigate(`/records/${created.id}/edit`);
        }
      } catch {
        showToast("儲存失敗，請重試", "error");
      } finally {
        setSaving(false);
      }
    },
    [
      caseName,
      orgName,
      visitType,
      visitDate,
      rawInput,
      refinedContent,
      outputFormat,
      autoRefine,
      caseProfileId,
      isEdit,
      id,
      navigate,
      showToast,
    ],
  );

  // --- Copy ---
  const handleCopy = useCallback(async () => {
    const tmp = document.createElement("div");
    tmp.innerHTML = refinedContent;
    const text = tmp.textContent || tmp.innerText || "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast("複製失敗", "error");
    }
  }, [refinedContent, showToast]);

  // --- Hotkeys ---
  useHotkeys("mod+s", (e) => {
    e.preventDefault();
    save("draft");
  });
  useHotkeys("mod+enter", (e) => {
    e.preventDefault();
    save("completed");
  });
  useHotkeys("mod+shift+c", (e) => {
    e.preventDefault();
    handleCopy();
  });

  // --- Input helpers ---
  const handleTranscribed = useCallback(
    (text: string) => {
      setRawInput((prev) => (prev ? prev + "\n" + text : text));
    },
    [],
  );

  const handleOcrComplete = useCallback(
    (text: string) => {
      setRawInput((prev) => (prev ? prev + "\n" + text : text));
    },
    [],
  );

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-8 animate-fade-in">
      <h2 className="text-xl font-bold text-gray-900">
        {isEdit ? "編輯紀錄" : "新增家電訪紀錄"}
      </h2>

      {/* STEP 1: Basic info */}
      <section className="card p-5">
        <StepHeader number={1} title="基本資訊" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative" ref={caseDropdownRef}>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              個案姓名 <span className="text-red-500">*</span>
            </label>
            {isEdit ? (
              <input
                type="text"
                value={caseName}
                disabled
                className="input-base py-3 text-[16px] md:text-sm min-h-[48px] disabled:bg-surface-50 disabled:text-gray-500"
              />
            ) : (
              <>
                <div className="relative">
                  <input
                    type="text"
                    value={caseSearch}
                    onChange={(e) => {
                      setCaseSearch(e.target.value);
                      setCaseProfileId(null);
                      setCaseName("");
                      setShowCaseDropdown(false);
                    }}
                    onFocus={() => {
                      if (caseDropdownResults.length > 0 && !caseProfileId) {
                        setShowCaseDropdown(true);
                      }
                    }}
                    placeholder="搜尋個案姓名..."
                    className="input-base py-3 text-[16px] md:text-sm min-h-[48px] pr-8"
                  />
                  {caseSearchLoading && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
                  )}
                  {caseProfileId && (
                    <button
                      type="button"
                      onClick={() => {
                        setCaseProfileId(null);
                        setCaseName("");
                        setCaseSearch("");
                        setOrgName("");
                        setCaseDropdownResults([]);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {showCaseDropdown && caseDropdownResults.length > 0 && (
                  <ul className="absolute z-20 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                    {caseDropdownResults.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setCaseName(p.name);
                            setOrgName(p.district || "");
                            setCaseProfileId(p.id);
                            setCaseSearch(p.name);
                            setShowCaseDropdown(false);
                          }}
                          className="w-full px-4 py-2.5 text-left text-sm hover:bg-surface-50 transition-colors"
                        >
                          <span className="font-medium text-gray-900">{p.name}</span>
                          <span className="ml-1.5 text-xs text-gray-400">（{p.id_number}）</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              居住區域 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              disabled={isEdit}
              placeholder="輸入居住區域"
              className="input-base py-3 text-[16px] md:text-sm min-h-[48px] disabled:bg-surface-50 disabled:text-gray-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-gray-900">
              訪視類型
            </label>
            <div className="flex gap-2">
              {(["home", "phone"] as const).map((t) => {
                const active = visitType === t;
                const Icon = t === "home" ? Home : Phone;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setVisitType(t)}
                    disabled={isEdit}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold transition-all min-h-[48px] ${
                      active
                        ? "border-gray-900 bg-gray-900 text-primary-500 shadow-md"
                        : "border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-surface-50"
                    } disabled:opacity-60`}
                  >
                    <Icon className={`h-4 w-4 ${active ? "text-primary-500" : "text-gray-400"}`} />
                    {t === "home" ? "家訪" : "電訪"}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-gray-900">
              訪視日期
            </label>
            <DatePicker
              selected={visitDate ? new Date(visitDate) : null}
              onChange={(date: Date | null) => {
                if (date) {
                  setVisitDate(format(date, "yyyy-MM-dd"));
                } else {
                  setVisitDate("");
                }
              }}
              dateFormat="yyyy-MM-dd"
              className="input-base w-full py-3 text-[16px] md:text-sm min-h-[48px]"
            />
          </div>
        </div>
      </section>

      {/* STEP 2: Raw input */}
      <section className="card p-6">
        <StepHeader number={2} title="輸入粗稿" />

        <textarea
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          onBlur={handleRawBlur}
          placeholder="在此輸入家電訪紀錄粗稿..."
          rows={8}
          className="mt-5 input-base py-3 text-[16px] md:text-sm resize-y"
        />

        <div className="mt-3 flex items-center justify-end gap-2">
          <VoiceRecorder onTranscribed={handleTranscribed} />
          <PhotoUploader onOcrComplete={handleOcrComplete} />
        </div>

        {/* Gap suggestions */}
        {!gapsDismissed && gaps.length > 0 && (
          <div className="mt-4 rounded-xl border border-gray-200 bg-surface-50 p-4 animate-fade-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-gray-400" />
                建議補充以下項目
              </div>
              <button
                type="button"
                onClick={() => setGapsDismissed(true)}
                className="rounded-lg p-1 text-gray-400 hover:bg-surface-100 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {gaps.map((gap) => (
                <div
                  key={gap.section}
                  className="group relative inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-bold text-primary-500 shadow-sm"
                >
                  {gap.section}
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    {gap.hint}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {checkingGaps && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            正在檢查紀錄完整度...
          </div>
        )}
      </section>

      {/* STEP 3: AI refine */}
      <section className="card p-6">
        <div className="flex items-center justify-between gap-4">
          <StepHeader number={3} title="AI 潤飾" />
          {/* Refine button — hero action, always visible next to header */}
          <button
            type="button"
            onClick={() => doRefine()}
            disabled={refining || !rawInput.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-500 px-5 py-2.5 text-sm font-black text-gray-900 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:brightness-105 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm min-h-[44px]"
          >
            {refining ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="hidden sm:inline">潤飾中...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                <span className="hidden sm:inline">立即潤飾</span>
              </>
            )}
          </button>
        </div>

        {/* Settings row — compact, secondary visual weight */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Format toggle */}
          <div className="inline-flex rounded-lg border border-gray-200 bg-surface-50 p-0.5">
            {(["bullet", "narrative"] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => handleFormatSwitch(fmt)}
                className={`rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                  outputFormat === fmt
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {fmt === "bullet" ? "條列式" : "敘述式"}
              </button>
            ))}
          </div>

          <div className="hidden sm:block h-5 w-px bg-gray-200" />

          {/* Tone selector */}
          <div className="inline-flex rounded-lg border border-gray-200 bg-surface-50 p-0.5">
            {([
              { value: "professional" as ToneStyle, label: "專業" },
              { value: "warm" as ToneStyle, label: "溫暖" },
              { value: "concise" as ToneStyle, label: "精簡" },
              { value: "detailed" as ToneStyle, label: "詳盡" },
            ]).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTone(value)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-bold transition-all ${
                  tone === value
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="hidden sm:block h-5 w-px bg-gray-200" />

          {/* Auto-refine toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs font-medium text-gray-500">自動潤飾</span>
            <button
              type="button"
              role="switch"
              aria-checked={autoRefine}
              onClick={() => setAutoRefine(!autoRefine)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                autoRefine ? "bg-gray-900" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full transition-transform shadow-sm ${
                  autoRefine ? "translate-x-[18px] bg-primary-500" : "translate-x-[3px] bg-white"
                }`}
              />
            </button>
          </label>
        </div>

        {/* Content panel with integrated view tabs */}
        <div className="mt-4 rounded-xl border border-gray-200 overflow-hidden">
          {/* Tab bar — attached to content panel top */}
          {!isStreaming && refinedContent.trim() && (
            <div className="flex items-center gap-px border-b border-gray-200 bg-surface-50">
              {([
                { mode: "edit" as ViewMode, icon: PenLine, label: "編輯" },
                { mode: "diff" as ViewMode, icon: GitCompareArrows, label: "差異比對" },
                { mode: "section" as ViewMode, icon: Columns2, label: "段落潤飾" },
              ]).map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold transition-all border-b-2 -mb-px ${
                    viewMode === mode
                      ? "border-gray-900 text-gray-900 bg-white"
                      : "border-transparent text-gray-400 hover:text-gray-600 hover:bg-surface-100"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Content area */}
          {isStreaming ? (
            <div className="bg-white p-4">
              <div className="flex items-center gap-2 mb-3 text-xs font-bold text-primary-600">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                AI 生成中...
              </div>
              <div
                className="prose prose-sm max-w-none min-h-[200px] text-gray-700"
                dangerouslySetInnerHTML={{ __html: streamingContent }}
              />
            </div>
          ) : viewMode === "diff" ? (
            <div className="border-0 [&>div]:border-0 [&>div]:rounded-none">
              <DiffView oldText={rawInput} newHtml={refinedContent} />
            </div>
          ) : viewMode === "section" ? (
            <div className="[&>div]:border-0 [&>div]:rounded-none">
              <SectionRefiner
                refinedContent={refinedContent}
                rawInput={rawInput}
                outputFormat={outputFormat}
                visitType={visitType}
                tone={tone}
                onUpdate={setRefinedContent}
                onToast={showToast}
              />
            </div>
          ) : (
            <div className="[&>div]:border-0 [&>div]:rounded-none">
              <RichEditor content={refinedContent} onChange={setRefinedContent} />
            </div>
          )}
        </div>
      </section>

      {/* Action bar */}
      <div className="card flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-5">
        <div className="flex gap-2 items-center justify-center sm:justify-start">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!refinedContent.trim()}
            className="btn-ghost text-sm disabled:opacity-40 w-full sm:w-auto"
          >
            {copied ? (
              <>
                <Check className="h-5 w-5 text-gray-900" />
                <span className="text-gray-900 font-bold">已複製</span>
              </>
            ) : (
              <>
                <Copy className="h-5 w-5" />
                複製內容
              </>
            )}
          </button>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-3">
          {isEdit && id && (
            <div className="col-span-2 grid grid-cols-2 gap-3 sm:flex sm:gap-3">
              <ExportDropdown
                recordId={id}
                caseName={caseName}
                visitDate={visitDate}
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => save("draft")}
            disabled={saving}
            className="btn-secondary py-3 flex-1 sm:flex-none justify-center"
            title="儲存草稿"
          >
            <Save className="h-5 w-5" />
            <span className="hidden sm:inline">儲存草稿</span>
          </button>
          <button
            type="button"
            onClick={() => save("completed")}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-6 py-3 text-sm font-black tracking-wide text-primary-500 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60"
          >
            <CheckCircle className="h-5 w-5" />
            完成紀錄
          </button>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-400">
        <Keyboard className="h-4 w-4" />
        {/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘" : "Ctrl"}+S 儲存草稿 ｜ {/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘" : "Ctrl"}+Enter 完成 ｜ {/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘" : "Ctrl"}+Shift+C 複製內容
      </div>

      <ConfirmModal
        open={showFormatConfirm}
        title="切換格式"
        message="切換格式將重新進行 AI 潤飾，目前的潤飾內容將被覆蓋，確定嗎？"
        confirmLabel="確認切換"
        onConfirm={confirmFormatSwitch}
        onCancel={() => {
          setShowFormatConfirm(false);
          pendingFormatRef.current = null;
        }}
      />
    </div>
  );
}

function StepHeader({ number, title }: { number: number; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-900 text-sm font-black text-primary-500">
        {number}
      </span>
      <h3 className="text-lg font-bold text-gray-900">{title}</h3>
    </div>
  );
}
