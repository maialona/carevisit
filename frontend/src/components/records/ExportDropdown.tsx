import { useCallback, useState } from "react";
import api from "../../api/axios";
import { useToast } from "../../contexts/ToastContext";
import { FileDown, FileText, Loader2 } from "lucide-react";

interface ExportDropdownProps {
  recordId: string;
  caseName?: string;
  visitDate?: string;
}

export default function ExportDropdown({
  recordId,
  caseName = "紀錄",
  visitDate = "",
}: ExportDropdownProps) {
  const { showToast } = useToast();
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);

  const download = useCallback(
    async (format: "pdf" | "docx") => {
      setExporting(format);
      try {
        const response = await api.get(
          `/records/${recordId}/export/${format}`,
          { responseType: "blob" },
        );
        const blob = new Blob([response.data]);
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        const dateStr = visitDate
          ? new Date(visitDate).toISOString().slice(0, 10).replace(/-/g, "")
          : "export";
        link.download = `訪視紀錄_${caseName}_${dateStr}.${format}`;
        link.click();
        window.URL.revokeObjectURL(url);
        showToast(`${format.toUpperCase()} 匯出成功`);
      } catch {
        showToast(`匯出失敗，請重試`, "error");
      } finally {
        setExporting(null);
      }
    },
    [recordId, caseName, visitDate, showToast],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => download("pdf")}
        disabled={exporting !== null}
        className="btn-secondary"
      >
        {exporting === "pdf" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileDown className="h-4 w-4 text-red-500" />
        )}
        PDF
      </button>
      <button
        type="button"
        onClick={() => download("docx")}
        disabled={exporting !== null}
        className="btn-secondary"
      >
        {exporting === "docx" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileText className="h-4 w-4 text-blue-500" />
        )}
        Word
      </button>
    </>
  );
}
