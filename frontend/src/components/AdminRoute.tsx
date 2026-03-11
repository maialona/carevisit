import { Navigate, Outlet } from "react-router-dom";
import { usePermission } from "../hooks/usePermission";

export default function AdminRoute({ children }: { children?: React.ReactNode }) {
  const { isAdmin } = usePermission();
  
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }
  
  return children ? <>{children}</> : <Outlet />;
}
