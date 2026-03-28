import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/authStore";
import { ToastProvider } from "./contexts/ToastContext";
import ToastContainer from "./components/ui/Toast";
import PrivateRoute from "./components/PrivateRoute";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import RecordsPage from "./pages/RecordsPage";
import RecordFormPage from "./pages/RecordFormPage";
import ClientsPage from "./pages/ClientsPage";
import ClientDetailPage from "./pages/ClientDetailPage";

import UsersManagementPage from "./pages/admin/UsersManagementPage";
import CaseProfilesPage from "./pages/admin/CaseProfilesPage";
import AuditLogPage from "./pages/admin/AuditLogPage";
import TokenAnalyticsPage from "./pages/admin/TokenAnalyticsPage";
import AdminRoute from "./components/AdminRoute";
import SchedulePage from "./pages/SchedulePage";
import RoutePlannerPage from "./pages/RoutePlannerPage";

function PublicRoute({ children }: { children: React.ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (accessToken) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const fetchUser = useAuthStore((s) => s.fetchUser);

  useEffect(() => {
    if (accessToken) {
      fetchUser();
    }
  }, [accessToken, fetchUser]);

  return (
    <ToastProvider>
      <BrowserRouter>
        <ToastContainer />
        <Routes>
          <Route
            path="/login"
            element={
              <PublicRoute>
                <LoginPage />
              </PublicRoute>
            }
          />
          <Route element={<PrivateRoute />}>
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/records" element={<RecordsPage />} />
              <Route path="/records/new" element={<RecordFormPage />} />
              <Route path="/records/:id/edit" element={<RecordFormPage />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/clients/detail" element={<ClientDetailPage />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="/route-planner" element={<RoutePlannerPage />} />

              <Route path="/admin/case-profiles" element={<CaseProfilesPage />} />
              <Route path="/admin/audit" element={<AuditLogPage />} />
              <Route path="/admin/token-analytics" element={<TokenAnalyticsPage />} />

              <Route element={<AdminRoute />}>
                <Route path="/admin/users" element={<UsersManagementPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
