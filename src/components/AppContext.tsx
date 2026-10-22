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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, getSupabaseConfigurationError } from "@/lib/supabase";
import { fetchProfile } from "@/lib/app-data";
import type { Profile, Route } from "@/lib/types";

const TAB_ROUTES = ["/home", "/income", "/team", "/share", "/account"];
const LANGUAGE_EVENT = "app-language-change";
const LEGACY_ROUTES: Record<string, string> = {
  "/pages/login/index": "/",
  "/pages/register/index": "/register",
  "/pages/home/index": "/home",
  "/pages/assets/index": "/income",
  "/pages/network/index": "/team",
  "/pages/share/index": "/share",
  "/pages/account/index": "/account",
  "/pages/deposit/index": "/deposit",
  "/pages/withdraw/index": "/withdraw",
  "/pages/records/index": "/records",
  "/pages/admin/index": "/admin/withdrawals",
  "/pages/about/index": "/about",
  "/pages/announce/index": "/about",
};

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const route = useMemo<Route>(() => ({
    path: pathname || "/",
    params: new URLSearchParams(searchParams.toString()),
  }), [pathname, searchParams]);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [activeToast, setActiveToast] = useState<Toast>(null);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const language = useSyncExternalStore(subscribeLanguage, getLanguageSnapshot, () => "English");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const legacyHashHandled = useRef(false);
  const configError = getSupabaseConfigurationError();

  const navigate = useCallback((path: string, params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    router.push(`${path}${qs}`);
  }, [router]);

  const goBack = useCallback(() => {
    if (window.history.length > 1) router.back();
    else navigate("/home");
  }, [navigate, router]);

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
    if (legacyHashHandled.current) return;
    legacyHashHandled.current = true;
    const legacy = window.location.hash.replace(/^#/, "");
    if (!legacy) return;

    const separator = legacy.indexOf("?");
    const oldPath = separator < 0 ? legacy : legacy.slice(0, separator);
    const query = separator < 0 ? "" : legacy.slice(separator + 1);
    const nextPath = LEGACY_ROUTES[oldPath];
    if (nextPath) router.replace(`${nextPath}${query ? `?${query}` : ""}`);
  }, [router]);

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
