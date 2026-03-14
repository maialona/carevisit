import { Navigate, Outlet } from "react-router-dom";
import { usePermission } from "../hooks/usePermission";
import { useAuthStore } from "../store/authStore";

export default function AdminRoute({ children }: { children?: React.ReactNode }) {
  const { isAdmin } = usePermission();
  const isLoading = useAuthStore((s) => s.isLoading);

  if (isLoading) return null;

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
