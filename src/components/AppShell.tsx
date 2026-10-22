"use client";

import { useEffect } from "react";
import { AppProvider, useApp } from "./AppContext";
import { AuthScreen } from "./AuthScreen";
import { BottomNav } from "./BottomNav";
import { HomePage } from "./HomePage";
import { MemberPages } from "./MemberPages";

export function AppShell() {
  return (
    <AppProvider>
      <AppFrame />
    </AppProvider>
  );
}

function AppFrame() {
  const { route, user, ready, navigate, activeToast } = useApp();
  const isAuthRoute = route.path.includes("/login/") || route.path.includes("/register/") || route.path.includes("/reset/");
  const isPublicAboutRoute = route.path === "/pages/about/index";

  useEffect(() => {
    if (!ready) return;
    if (!user && !isAuthRoute && !isPublicAboutRoute) navigate("/pages/login/index");
    if (user && isAuthRoute) navigate("/pages/home/index");
  }, [ready, user, isAuthRoute, isPublicAboutRoute, navigate]);

  let content;
  if (!ready) {
    content = (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading account">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
      </div>
    );
  } else if (!user) {
    content = isPublicAboutRoute
      ? <MemberPages path={route.path} />
      : <AuthScreen key={`${route.path}:${route.params.toString()}`} />;
  } else if (route.path === "/pages/home/index" || isAuthRoute) {
    content = <HomePage />;
  } else {
    content = <MemberPages path={route.path} />;
  }

  return (
    <div className="phone-shell">
      {content}
      {user && <BottomNav />}
      {activeToast && (
        <div
          className={`toast-pop fixed left-1/2 top-4 z-[100] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xl px-4 py-3 text-center text-[13px] font-medium text-white shadow-lg ${
            activeToast.kind === "error" ? "bg-danger" : "bg-ink"
          }`}
          role={activeToast.kind === "error" ? "alert" : "status"}
        >
          {activeToast.text}
        </div>
      )}
    </div>
  );
}