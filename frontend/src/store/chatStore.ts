import { create } from "zustand";

interface ChatStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
