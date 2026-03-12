import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { aiApi } from "../../api/ai";

interface SectionRefinerProps {
  refinedContent: string;
  rawInput: string;
  outputFormat: "bullet" | "narrative";
  visitType: "home" | "phone";
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
  onUpdate,
  onToast,
}: SectionRefinerProps) {
  const [refiningId, setRefiningId] = useState<number | null>(null);
  const sectionsRef = useRef<Section[]>([]);

  const sections = useMemo(() => {
    const s = splitSections(refinedContent);
    sectionsRef.current = s;
    return s;
  }, [refinedContent]);

  const handleRefineSection = useCallback(
    async (section: Section) => {
      if (refiningId !== null) return;
      setRefiningId(section.id);

      try {
        const result = await aiApi.refineSection({
          section_html: section.html,
          context: rawInput,
          format: outputFormat,
          visit_type: visitType,
        });

        // Replace the section in the full content
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
    [refiningId, rawInput, outputFormat, visitType, onUpdate, onToast],
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
        const hasHeading = /^<h[45]/i.test(section.html);

        return (
          <div key={section.id} className="group relative">
            {/* Refine button - only show for sections with headings */}
            {hasHeading && (
              <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
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
