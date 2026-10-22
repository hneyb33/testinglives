"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, getSupabaseConfigurationError } from "@/lib/supabase";
import { fetchProfile } from "@/lib/app-data";
import type { Profile, Route } from "@/lib/types";

const TAB_ROUTES = ["/pages/home/index", "/pages/assets/index", "/pages/network/index", "/pages/share/index", "/pages/account/index"];
const LANGUAGE_EVENT = "app-language-change";

function subscribeLanguage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(LANGUAGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(LANGUAGE_EVENT, onStoreChange);
  };
}

function getLanguageSnapshot() {
  return window.localStorage.getItem("app-language") ?? "English";
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/pages/home/index";
  const [path = "/pages/home/index", query = ""] = raw.split("?");
  return { path, params: new URLSearchParams(query) };
}

type Toast = { id: number; text: string; kind: "info" | "error" } | null;

type AppContextValue = {
  route: Route;
  navigate: (path: string, params?: Record<string, string>) => void;
  goBack: () => void;
  user: User | null;
  profile: Profile | null;
  ready: boolean;
  configError: string | null;
  refreshProfile: () => Promise<void>;
  balanceVisible: boolean;
  toggleBalanceVisible: () => void;
  toast: (text: string, kind?: "info" | "error") => void;
  activeToast: Toast;
  language: string;
  setLanguage: (lang: string) => void;
  isTabRoute: boolean;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>({ path: "/pages/login/index", params: new URLSearchParams() });
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [activeToast, setActiveToast] = useState<Toast>(null);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const language = useSyncExternalStore(subscribeLanguage, getLanguageSnapshot, () => "English");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configError = getSupabaseConfigurationError();

  const navigate = useCallback((path: string, params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    window.location.hash = `${path}${qs}`;
  }, []);

  const goBack = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else navigate("/pages/home/index");
  }, [navigate]);

  const toast = useCallback((text: string, kind: "info" | "error" = "info") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setActiveToast({ id: Date.now(), text, kind });
    toastTimer.current = setTimeout(() => setActiveToast(null), 2600);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (configError) return;
    try {
      const client = getSupabaseBrowserClient();
      const { data } = await client.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) {
        setProfile(null);
        return;
      }
      setProfile(await fetchProfile(client, uid));
    } catch {
      setProfile(null);
    }
  }, [configError]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (configError) return;
    const client = getSupabaseBrowserClient();
    let active = true;

    const syncProfile = (uid: string) => {
      void fetchProfile(client, uid)
        .then((nextProfile) => { if (active) setProfile(nextProfile); })
        .catch(() => { if (active) setProfile(null); });
    };

    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      setReady(true);
      if (sessionUser) syncProfile(sessionUser.id);
      else setProfile(null);
    }).catch(() => {
      if (active) setReady(true);
    });

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) syncProfile(sessionUser.id);
      else setProfile(null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [configError]);

  const changeLanguage = useCallback((lang: string) => {
    window.localStorage.setItem("app-language", lang);
    window.dispatchEvent(new Event(LANGUAGE_EVENT));
  }, []);

  const isTabRoute = TAB_ROUTES.includes(route.path);

  const value = useMemo<AppContextValue>(
    () => ({
      route,
      navigate,
      goBack,
      user,
      profile,
      ready: ready || Boolean(configError),
      configError,
      refreshProfile,
      balanceVisible,
      toggleBalanceVisible: () => setBalanceVisible((v) => !v),
      toast,
      activeToast,
      language,
      setLanguage: changeLanguage,
      isTabRoute,
    }),
    [route, navigate, goBack, user, profile, ready, configError, refreshProfile, balanceVisible, toast, activeToast, language, changeLanguage, isTabRoute],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
