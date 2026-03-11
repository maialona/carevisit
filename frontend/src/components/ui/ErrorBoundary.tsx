import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center bg-gray-50 p-4 text-center">
          <div className="mb-4 rounded-full bg-red-100 p-4">
            <span className="text-4xl text-red-500">⚠️</span>
          </div>
          <h1 className="mb-2 text-2xl font-bold text-gray-900">Oops! 系統發生預期外的錯誤</h1>
          <p className="mb-6 text-gray-600">很抱歉，處理您的請求時發生問題。</p>
          <button
            className="rounded-lg bg-primary-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-primary-700"
            onClick={() => window.location.reload()}
          >
            重新載入頁面
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
