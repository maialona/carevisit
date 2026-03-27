import { CheckCircle, AlertCircle, X } from "lucide-react";
import { useToast } from "../../contexts/ToastContext";

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium shadow-lg animate-slide-up min-w-[220px] max-w-sm"
        >
          {t.type === "success" ? (
            <CheckCircle className="h-4 w-4 text-primary-500 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          )}
          <span className="flex-1 text-white">{t.message}</span>
          <button
            onClick={() => removeToast(t.id)}
            className="ml-1 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
