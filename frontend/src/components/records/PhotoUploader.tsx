import { useCallback, useRef, useState, type DragEvent } from "react";
import { aiApi } from "../../api/ai";
import { useToast } from "../../contexts/ToastContext";
import { ImagePlus, Loader2, Send, X } from "lucide-react";

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
    <div className="flex flex-col gap-3">
      {/* Drop zone / button */}
      {!preview && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex h-24 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed transition-all ${
            dragging
              ? "border-primary-400 bg-primary-50"
              : "border-gray-200 hover:border-gray-300 hover:bg-surface-50"
          }`}
        >
          <div className="flex flex-col items-center gap-1.5 text-gray-400">
            <ImagePlus className="h-6 w-6" />
            <span className="text-xs">
              點擊拍照/選檔，或拖曳圖片至此
            </span>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Preview */}
      {preview && (
        <div className="flex items-start gap-3">
          <div className="relative">
            <img
              src={preview}
              alt="上傳預覽"
              className="h-20 w-20 rounded-xl object-cover border border-gray-200"
            />
            <button
              type="button"
              onClick={clear}
              disabled={processing}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-white transition-opacity hover:bg-gray-700 disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={handleOcr}
              disabled={processing}
              className="btn-primary py-2 text-sm"
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  辨識中...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  送出辨識
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
