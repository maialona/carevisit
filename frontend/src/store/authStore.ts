import { create } from "zustand";
import api from "../api/axios";
import type { User, TokenResponse } from "../types";

interface AuthStore {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  fetchUser: () => Promise<void>;
  setUser: (user: User | null) => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  accessToken: localStorage.getItem("access_token"),
  isLoading: false,

  login: async (email: string, password: string) => {
    const { data } = await api.post<TokenResponse>(
      "/auth/login",
      { username: email, password },
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    localStorage.setItem("access_token", data.access_token);
    localStorage.setItem("refresh_token", data.refresh_token);
    set({ accessToken: data.access_token });

    // Fetch user profile
    const userRes = await api.get<User>("/auth/me");
    set({ user: userRes.data });
  },

  logout: () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    set({ user: null, accessToken: null });
  },

  refreshToken: async () => {
    const rt = localStorage.getItem("refresh_token");
    if (!rt) return;
    const { data } = await api.post<{ access_token: string }>(
      "/auth/refresh",
      { refresh_token: rt },
    );
    localStorage.setItem("access_token", data.access_token);
    set({ accessToken: data.access_token });
  },

  fetchUser: async () => {
    set({ isLoading: true });
    try {
      const { data } = await api.get<User>("/auth/me");
      set({ user: data });
    } catch {
      set({ user: null, accessToken: null });
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
    } finally {
      set({ isLoading: false });
    }
  },

  setUser: (user: User | null) => {
    set({ user });
  },

  hydrate: () => {
    const token = localStorage.getItem("access_token");
    if (token) {
      set({ accessToken: token });
    }
  },
}));
