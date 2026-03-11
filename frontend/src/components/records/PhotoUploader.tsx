import { useCallback, useRef, useState, type DragEvent } from "react";
import { aiApi } from "../../api/ai";
import { useToast } from "../../contexts/ToastContext";
import { Camera, Loader2, Send, X } from "lucide-react";

interface PhotoUploaderProps {
  onOcrComplete: (text: string) => void;
}

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export default function PhotoUploader({ onOcrComplete }: PhotoUploaderProps) {
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);

  const validateAndSet = useCallback(
    (f: File) => {
      if (!ALLOWED_TYPES.includes(f.type)) {
        showToast("僅支援 JPG、PNG、WebP 格式", "error");
        return;
      }
      if (f.size > MAX_SIZE) {
        showToast("圖片大小超過 10MB 上限", "error");
        return;
      }
      setFile(f);
      setPreview(URL.createObjectURL(f));
    },
    [showToast],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) validateAndSet(f);
    },
    [validateAndSet],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) validateAndSet(f);
    },
    [validateAndSet],
  );

  const handleOcr = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    try {
      const result = await aiApi.ocr(file);
      onOcrComplete(result.text);
      showToast("圖片文字辨識完成");
      clear();
    } catch {
      showToast("圖片辨識失敗，請重試", "error");
    } finally {
      setProcessing(false);
    }
  }, [file, onOcrComplete, showToast]);

  const clear = () => {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {!preview ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
            dragging
              ? "border-primary-400 bg-primary-50 text-primary-600"
              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-surface-50 hover:text-gray-900"
          }`}
          title="拍照/上傳圖片"
        >
          <Camera className="h-3.5 w-3.5" />
          拍照/上傳
        </button>
      ) : (
        <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
          <img
            src={preview}
            alt="預覽"
            className="h-8 w-8 rounded object-cover"
          />
          <button
            type="button"
            onClick={handleOcr}
            disabled={processing}
            className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
          >
            {processing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                辨識中
              </>
            ) : (
              <>
                <Send className="h-3 w-3" />
                辨識文字
              </>
            )}
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={processing}
            className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            title="清除"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  );
}
