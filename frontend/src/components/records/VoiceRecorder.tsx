import { useCallback, useEffect, useRef, useState } from "react";
import { aiApi } from "../../api/ai";
import { useToast } from "../../contexts/ToastContext";
import { Mic, Square, Loader2, Send, X } from "lucide-react";

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
      clear();
    } catch {
      showToast("語音轉文字失敗，請重試", "error");
    } finally {
      setTranscribing(false);
    }
  }, [audioBlob, onTranscribed, showToast]);

  const clear = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setElapsed(0);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  if (!supported) return null;

  // Idle state: compact icon button
  if (!recording && !audioUrl) {
    return (
      <button
        type="button"
        onClick={startRecording}
        disabled={transcribing}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition-all hover:border-gray-300 hover:bg-surface-50 hover:text-gray-900 disabled:opacity-50"
        title="語音錄音"
      >
        <Mic className="h-3.5 w-3.5" />
        語音錄音
      </button>
    );
  }

  // Recording state
  if (recording) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs font-medium text-red-600">
          {formatTime(elapsed)}
        </span>
        <button
          type="button"
          onClick={stopRecording}
          className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500 text-white transition-colors hover:bg-red-600"
          title="停止錄音"
        >
          <Square className="h-3 w-3" />
        </button>
      </div>
    );
  }

  // Review state: audio recorded, ready to transcribe
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <audio src={audioUrl!} controls className="h-8 w-40" />
      <button
        type="button"
        onClick={handleTranscribe}
        disabled={transcribing}
        className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
      >
        {transcribing ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            轉換中
          </>
        ) : (
          <>
            <Send className="h-3 w-3" />
            轉文字
          </>
        )}
      </button>
      <button
        type="button"
        onClick={clear}
        disabled={transcribing}
        className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
        title="清除"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
