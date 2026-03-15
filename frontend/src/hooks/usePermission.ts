import { useAuthStore } from "../store/authStore";

export function usePermission() {
  const { user } = useAuthStore();

  const isAdmin = user?.role === "admin";
  const isSupervisor = user?.role === "supervisor";

  return {
    isAdmin,
    isSupervisor,

    canCreateCase: isAdmin || (isSupervisor && (user?.can_create_case ?? false)),
    canDeleteCase: isAdmin || (isSupervisor && (user?.can_delete_case ?? false)),

    canEditRecord: (recordUserId: string) =>
      isAdmin || user?.id === recordUserId,
    canDeleteRecord: (recordUserId: string) =>
      isAdmin || user?.id === recordUserId,
    canManageUsers: isAdmin,
  };
}
