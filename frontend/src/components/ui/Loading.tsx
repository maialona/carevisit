import { Loader2 } from "lucide-react";

export function PageLoader() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      <p className="mt-4 text-sm font-medium text-gray-500">載入中...</p>
    </div>
  );
}

export function ButtonSpinner() {
  return (
    <Loader2 className="h-4 w-4 animate-spin opacity-75" />
  );
}

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div className={`animate-pulse rounded-md bg-gray-200 ${className}`}></div>
  );
}
