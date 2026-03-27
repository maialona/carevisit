import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2, PlusCircle, RefreshCw, Sparkles } from "lucide-react";
import { aiApi } from "../../api/ai";
import type { ToneStyle } from "../../types";

interface SectionRefinerProps {
  refinedContent: string;
  rawInput: string;
  outputFormat: "bullet" | "narrative";
  visitType: "home" | "phone";
  tone: ToneStyle;
  customPrompt?: string;
  onUpdate: (newHtml: string) => void;
  onToast: (msg: string, type?: "success" | "error") => void;
}

interface Section {
  id: number;
  html: string;
}

/** Split refined HTML into sections by <h4> or <h5> boundaries. */
function splitSections(html: string): Section[] {
  if (!html.trim()) return [];

  // Split on heading tags while keeping them
  const parts = html.split(/(?=<h[45][^>]*>)/i);
  const sections: Section[] = [];
  let id = 0;

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Only treat as a section if it starts with a heading or contains meaningful content
    sections.push({ id: id++, html: trimmed });
  }

  return sections;
}

export default function SectionRefiner({
  refinedContent,
  rawInput,
  outputFormat,
  visitType,
  tone,
  customPrompt,
  onUpdate,
  onToast,
}: SectionRefinerProps) {
  const [refiningId, setRefiningId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sectionPrompt, setSectionPrompt] = useState("");
  const sectionsRef = useRef<Section[]>([]);

  const sections = useMemo(() => {
    const s = splitSections(refinedContent);
    sectionsRef.current = s;
    return s;
  }, [refinedContent]);

  const handleRefineSection = useCallback(
    async (section: Section, extraPrompt?: string) => {
      if (refiningId !== null) return;
      setRefiningId(section.id);
      setExpandedId(null);
      setSectionPrompt("");

      const combinedPrompt = [customPrompt, extraPrompt].filter(Boolean).join("；") || undefined;

      try {
        const result = await aiApi.refineSection({
          section_html: section.html,
          context: rawInput,
          format: outputFormat,
          visit_type: visitType,
          tone,
          ...(combinedPrompt && { custom_prompt: combinedPrompt }),
        });

        const current = sectionsRef.current;
        const newSections = current.map((s) =>
          s.id === section.id ? { ...s, html: result.refined_html } : s,
        );
        const newHtml = newSections.map((s) => s.html).join("\n");
        onUpdate(newHtml);
        onToast(`段落潤飾完成（${result.tokens_used} tokens）`);
      } catch {
        onToast("段落潤飾失敗，請重試", "error");
      } finally {
        setRefiningId(null);
      }
    },
    [refiningId, rawInput, outputFormat, visitType, tone, customPrompt, onUpdate, onToast],
  );

  const handleAppendSection = useCallback(
    async (section: Section, extraPrompt?: string) => {
      if (refiningId !== null) return;
      setRefiningId(section.id);
      setExpandedId(null);
      setSectionPrompt("");

      const combinedPrompt = [customPrompt, extraPrompt].filter(Boolean).join("；") || undefined;

      try {
        const result = await aiApi.refineSection({
          section_html: section.html,
          context: rawInput,
          format: outputFormat,
          visit_type: visitType,
          tone,
          mode: "append",
          ...(combinedPrompt && { custom_prompt: combinedPrompt }),
        });

        const current = sectionsRef.current;
        const newSections = current.map((s) =>
          s.id === section.id ? { ...s, html: s.html + "\n" + result.refined_html } : s,
        );
        const newHtml = newSections.map((s) => s.html).join("\n");
        onUpdate(newHtml);
        onToast(`段落補充完成（${result.tokens_used} tokens）`);
      } catch {
        onToast("段落補充失敗，請重試", "error");
      } finally {
        setRefiningId(null);
      }
    },
    [refiningId, rawInput, outputFormat, visitType, tone, customPrompt, onUpdate, onToast],
  );

  if (!refinedContent.trim()) {
    return (
      <div className="rounded-xl border border-gray-200 p-4 text-sm text-gray-400 italic min-h-[200px] flex items-center justify-center">
        AI 潤飾結果將顯示於此
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
      {sections.map((section) => {
        const isRefining = refiningId === section.id;
        const isExpanded = expandedId === section.id;
        const hasHeading = /^<h[45]/i.test(section.html);

        return (
          <div key={section.id} className="group relative">
            {/* Refine controls - only show for sections with headings */}
            {hasHeading && (
              <div className="absolute right-2 top-2 z-10">
                {isExpanded ? (
                  /* Expanded: input + buttons */
                  <div className="flex items-center gap-1.5 rounded-xl bg-gray-900 p-1.5 shadow-lg">
                    <input
                      autoFocus
                      type="text"
                      value={sectionPrompt}
                      onChange={(e) => setSectionPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) handleRefineSection(section, sectionPrompt);
                        if (e.key === "Escape") { setExpandedId(null); setSectionPrompt(""); }
                      }}
                      placeholder="額外指令（可留空）"
                      className="w-44 rounded-lg bg-gray-800 px-2 py-1 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleRefineSection(section, sectionPrompt)}
                      disabled={refiningId !== null}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary-500 px-2 py-1 text-xs font-bold text-gray-900 disabled:opacity-50"
                      title="改寫此段落"
                    >
                      <Sparkles className="h-3 w-3" />
                      改寫
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAppendSection(section, sectionPrompt)}
                      disabled={refiningId !== null}
                      className="inline-flex items-center gap-1 rounded-lg bg-gray-700 px-2 py-1 text-xs font-bold text-primary-400 disabled:opacity-50 hover:bg-gray-600"
                      title="在現有內容後補充更多"
                    >
                      <PlusCircle className="h-3 w-3" />
                      補充
                    </button>
                    <button
                      type="button"
                      onClick={() => { setExpandedId(null); setSectionPrompt(""); }}
                      className="px-1 text-gray-500 hover:text-white text-xs"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  /* Collapsed: quick buttons + expand */
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleRefineSection(section)}
                      disabled={refiningId !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-bold text-primary-500 shadow-md transition-all hover:shadow-lg disabled:opacity-50"
                      title="重新潤飾此段落"
                    >
                      {isRefining ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          潤飾中
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-3 w-3" />
                          重新潤飾
                        </>
                      )}
                    </button>
                    {!isRefining && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleAppendSection(section)}
                          disabled={refiningId !== null}
                          className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-primary-400 shadow-md hover:text-white disabled:opacity-50"
                          title="在現有內容後繼續補充"
                        >
                          <PlusCircle className="h-3 w-3" />
                          繼續補充
                        </button>
                        <button
                          type="button"
                          onClick={() => { setExpandedId(section.id); setSectionPrompt(""); }}
                          disabled={refiningId !== null}
                          className="inline-flex items-center rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-400 shadow-md hover:text-white disabled:opacity-50"
                          title="輸入自訂指令"
                        >
                          自訂
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <div
              className={`prose prose-sm max-w-none p-4 transition-colors ${
                isRefining
                  ? "bg-primary-50/50"
                  : hasHeading
                    ? "hover:bg-surface-50"
                    : ""
              }`}
              dangerouslySetInnerHTML={{ __html: section.html }}
            />
          </div>
        );
      })}
    </div>
  );
}
