import { create } from "zustand";
import api from "../api/axios";
import type { OrgSettings } from "../types";

interface OrgStore {
  settings: OrgSettings | null;
  fetchSettings: () => Promise<void>;
  setSettings: (s: OrgSettings) => void;
}

export const useOrgStore = create<OrgStore>((set) => ({
  settings: null,

  fetchSettings: async () => {
    try {
      const { data } = await api.get<OrgSettings>("/org/settings");
      set({ settings: data });
    } catch {
      // silently fail — permissions will default to admin-only
    }
  },

  setSettings: (s) => set({ settings: s }),
}));
