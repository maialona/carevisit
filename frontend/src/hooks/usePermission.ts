import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";

export function usePermission() {
  const { user } = useAuthStore();
  const settings = useOrgStore((s) => s.settings);

  const isAdmin = user?.role === "admin";
  const isSupervisor = user?.role === "supervisor";

  return {
    isAdmin,
    isSupervisor,

    canCreateCase: isAdmin || (isSupervisor && (settings?.supervisor_can_create_case ?? false)),
    canDeleteCase: isAdmin || (isSupervisor && (settings?.supervisor_can_delete_case ?? false)),

    canEditRecord: (recordUserId: string) =>
      isAdmin || user?.id === recordUserId,
    canDeleteRecord: (recordUserId: string) =>
      isAdmin || user?.id === recordUserId,
    canManageUsers: isAdmin,
  };
}
