import { useCallback, useEffect, useRef, useState } from "react";
import { aiApi } from "../../api/ai";
import { useToast } from "../../contexts/ToastContext";
import { Mic, Square, Loader2, Send } from "lucide-react";

interface VoiceRecorderProps {
  onTranscribed: (text: string) => void;
}

const MAX_DURATION = 10 * 60; // 10 minutes in seconds

export default function VoiceRecorder({ onTranscribed }: VoiceRecorderProps) {
  const { showToast } = useToast();
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setSupported(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
      };

      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
      setAudioUrl(null);
      setAudioBlob(null);

      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          if (prev + 1 >= MAX_DURATION) {
            recorder.stop();
            setRecording(false);
            if (timerRef.current) clearInterval(timerRef.current);
            return prev + 1;
          }
          return prev + 1;
        });
      }, 1000);
    } catch {
      showToast("無法存取麥克風，請確認瀏覽器權限", "error");
    }
  }, [showToast]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleTranscribe = useCallback(async () => {
    if (!audioBlob) return;
    setTranscribing(true);
    try {
      const ext = audioBlob.type.includes("webm") ? "webm" : "m4a";
      const file = new File([audioBlob], `recording.${ext}`, {
        type: audioBlob.type,
      });
      const result = await aiApi.transcribe(file);
      onTranscribed(result.text);
      showToast(`語音轉文字完成（${result.duration.toFixed(1)} 秒）`);
    } catch {
      showToast("語音轉文字失敗，請重試", "error");
    } finally {
      setTranscribing(false);
    }
  }, [audioBlob, onTranscribed, showToast]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  if (!supported) {
    return (
      <p className="text-xs text-gray-400">
        您的瀏覽器不支援錄音功能
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {!recording ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={transcribing}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-red-600 text-white shadow-sm transition-all hover:shadow-md hover:scale-105 active:scale-95 disabled:opacity-50"
            title="開始錄音"
          >
            <Mic className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-red-600 text-white shadow-sm animate-pulse"
            title="停止錄音"
          >
            <Square className="h-4 w-4" />
          </button>
        )}

        {recording && (
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-medium text-red-600">
              錄音中 {formatTime(elapsed)}
            </span>
          </div>
        )}
      </div>

      {audioUrl && !recording && (
        <div className="flex flex-col gap-2">
          <audio src={audioUrl} controls className="h-10 w-full max-w-xs" />
          <button
            type="button"
            onClick={handleTranscribe}
            disabled={transcribing}
            className="btn-primary w-fit py-2 text-sm"
          >
            {transcribing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                轉換中...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                送出轉換
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
