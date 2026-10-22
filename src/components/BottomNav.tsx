"use client";

import { useApp } from "./AppContext";
import { IconHome, IconIncome, IconShare, IconTeam, IconUser } from "./Icons";
import type { TabKey } from "@/lib/types";

const ITEMS: { key: TabKey; label: string; path: string; Icon: typeof IconHome }[] = [
  { key: "home", label: "Home", path: "/home", Icon: IconHome },
  { key: "assets", label: "Income", path: "/income", Icon: IconIncome },
  { key: "network", label: "Team", path: "/team", Icon: IconTeam },
  { key: "share", label: "Share", path: "/share", Icon: IconShare },
  { key: "account", label: "Me", path: "/account", Icon: IconUser },
];

export function BottomNav() {
  const { route, navigate, isTabRoute } = useApp();
  if (!isTabRoute) return null;

  const active = ITEMS.find((item) => route.path === item.path)?.key ?? "home";

  return (
    <nav className="fixed bottom-0 left-1/2 z-40 flex h-[68px] w-full max-w-[480px] -translate-x-1/2 items-stretch justify-around border-t border-line-blue/60 bg-white/98 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_-24px_rgba(37,38,43,0.55)]">
      {ITEMS.map(({ key, label, path, Icon }) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            type="button"
            onClick={() => navigate(path)}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-[3px] border-0 bg-transparent pt-2 ${
              isActive ? "text-primary" : "text-[#878787]"
            }`}
          >
            <Icon width={24} height={24} strokeWidth={isActive ? 2.1 : 1.7} />
            <span className={`text-[11px] leading-none ${isActive ? "font-bold" : "font-medium"}`}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
