import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useHotkeys } from "react-hotkeys-hook";
import { recordsApi } from "../api/records";
import { aiApi } from "../api/ai";
import { useToast } from "../contexts/ToastContext";
import VoiceRecorder from "../components/records/VoiceRecorder";
import PhotoUploader from "../components/records/PhotoUploader";
import RichEditor from "../components/records/RichEditor";
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
} from "lucide-react";
import type { VisitRecord } from "../types";

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
  const [visitType, setVisitType] = useState<VisitType>("home");
  const [visitDate, setVisitDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  // Step 2
  const [rawInput, setRawInput] = useState("");

  // Step 3
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(
    "bullet",
  );
  const [autoRefine, setAutoRefine] = useState(() => {
    return localStorage.getItem("carevisit_auto_refine") === "true";
  });
  const [refinedContent, setRefinedContent] = useState("");
  const [copied, setCopied] = useState(false);
  const [showFormatConfirm, setShowFormatConfirm] = useState(false);
  const pendingFormatRef = useRef<OutputFormat | null>(null);


  // Load existing record for edit
  useEffect(() => {
    if (!id) return;
    recordsApi
      .getById(id)
      .then((r: VisitRecord) => {
        setCaseName(r.case_name);
        setOrgName(r.org_name);
        setVisitType(r.visit_type);
        setVisitDate(r.visit_date.slice(0, 10));
        setRawInput(r.raw_input);
        setRefinedContent(r.refined_content);
        setOutputFormat(r.output_format);
        setAutoRefine(r.auto_refine);
      })
      .catch(() => showToast("載入紀錄失敗", "error"))
      .finally(() => setLoading(false));
  }, [id, showToast]);

  // Persist autoRefine to localStorage
  useEffect(() => {
    localStorage.setItem("carevisit_auto_refine", String(autoRefine));
  }, [autoRefine]);

  // --- AI refine ---
  const doRefine = useCallback(async (formatOverride?: OutputFormat) => {
    if (!rawInput.trim() || refining) return;
    setRefining(true);
    try {
      const result = await aiApi.refine({
        text: rawInput,
        format: formatOverride || outputFormat,
        visit_type: visitType,
        record_id: id,
      });
      setRefinedContent(result.refined_text);
      showToast(`潤飾完成（使用 ${result.tokens_used} tokens）`);
    } catch {
      showToast("AI 潤飾失敗，請重試", "error");
    } finally {
      setRefining(false);
    }
  }, [rawInput, outputFormat, visitType, id, refining, showToast]);

  // Auto-refine on blur
  const handleRawBlur = useCallback(() => {
    if (autoRefine && rawInput.trim()) {
      doRefine();
    }
  }, [autoRefine, rawInput, doRefine]);

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
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              個案姓名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={caseName}
              onChange={(e) => setCaseName(e.target.value)}
              disabled={isEdit}
              placeholder="輸入個案姓名"
              className="input-base py-3 text-[16px] md:text-sm min-h-[48px] disabled:bg-surface-50 disabled:text-gray-500"
            />
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
      </section>

      {/* STEP 3: AI refine */}
      <section className="card p-6">
        <StepHeader number={3} title="AI 潤飾" />

        <div className="mt-5 mb-5 flex flex-wrap items-center gap-4">
          {/* Format toggle */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-gray-900">格式</span>
            <div className="inline-flex rounded-xl border border-gray-200 bg-surface-50 p-1">
              {(["bullet", "narrative"] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => handleFormatSwitch(fmt)}
                  className={`rounded-lg px-4 py-2 text-sm font-bold transition-all ${
                    outputFormat === fmt
                      ? "bg-gray-900 text-white shadow-sm"
                      : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  {fmt === "bullet" ? "條列式" : "敘述式"}
                </button>
              ))}
            </div>
          </div>

          {/* Auto-refine toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <span className="text-sm font-bold text-gray-900">自動潤飾</span>
            <button
              type="button"
              role="switch"
              aria-checked={autoRefine}
              onClick={() => setAutoRefine(!autoRefine)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoRefine ? "bg-gray-900" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full transition-transform shadow-sm ${
                  autoRefine ? "translate-x-[22px] bg-primary-500" : "translate-x-[4px] bg-white"
                }`}
              />
            </button>
          </label>

          <div className="flex-1" />

          {/* Refine button */}
          <button
            type="button"
            onClick={() => doRefine()}
            disabled={refining || !rawInput.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-500 px-6 py-3 text-sm font-black text-gray-900 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:brightness-105 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm w-full sm:w-auto min-h-[48px]"
          >
            {refining ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                潤飾中...
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5" />
                立即潤飾
              </>
            )}
          </button>
        </div>

        {/* Rich editor */}
        {refining ? (
          <div className="animate-pulse space-y-4 rounded-xl border border-gray-200 bg-surface-50 p-6">
            <div className="h-4 w-3/4 rounded bg-gray-200" />
            <div className="h-4 w-full rounded bg-gray-200" />
            <div className="h-4 w-5/6 rounded bg-gray-200" />
            <div className="h-4 w-2/3 rounded bg-gray-200" />
          </div>
        ) : (
          <RichEditor content={refinedContent} onChange={setRefinedContent} />
        )}
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
