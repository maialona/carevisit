import { useAuthStore } from "../store/authStore";

export function usePermission() {
  const { user } = useAuthStore();

  return {
    isAdmin: user?.role === "admin",
    isSupervisor: user?.role === "supervisor",

    canDeleteCase: user?.role === "admin",
    canEditRecord: (recordUserId: string) =>
      user?.role === "admin" || user?.id === recordUserId,
    canDeleteRecord: (recordUserId: string) =>
      user?.role === "admin" || user?.id === recordUserId,
    canManageUsers: user?.role === "admin",
  };
}
