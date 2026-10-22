"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let installedByEvent = false;
const installStateListeners = new Set<() => void>();

function markInstalled() {
  installedByEvent = true;
  installStateListeners.forEach((listener) => listener());
}

function subscribeToInstallState(onChange: () => void) {
  const standaloneQuery = window.matchMedia("(display-mode: standalone)");
  installStateListeners.add(onChange);
  standaloneQuery.addEventListener("change", onChange);
  window.addEventListener("appinstalled", markInstalled);
  return () => {
    installStateListeners.delete(onChange);
    standaloneQuery.removeEventListener("change", onChange);
    window.removeEventListener("appinstalled", markInstalled);
  };
}

function getInstallState() {
  return installedByEvent
    || window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in window.navigator && window.navigator.standalone === true);
}

export function InstallAppButton({ className = "" }: { className?: string }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const installed = useSyncExternalStore(subscribeToInstallState, getInstallState, () => false);
  const [help, setHelp] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
    };
  }, []);

  async function install() {
    setHelp("");
    if (!installPrompt) {
      const isAppleMobile = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
      setHelp(isAppleMobile
        ? "To install, tap Share in Safari, then choose Add to Home Screen."
        : "Open your browser menu and choose Install app or Add to Home screen.");
      return;
    }

    setBusy(true);
    try {
      const prompt = installPrompt;
      setInstallPrompt(null);
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") markInstalled();
    } catch {
      setHelp("The install prompt could not be opened. Try Install app or Add to Home screen from your browser menu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void install()}
        disabled={installed || busy}
        className={className || "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-primary/25 bg-white px-3 text-[12px] font-semibold text-primary disabled:cursor-default disabled:opacity-70"}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 17v3h14v-3" />
        </svg>
        {installed ? "App installed" : busy ? "Opening..." : "Download app"}
      </button>
      {help && <p role="status" className="m-0 max-w-[240px] text-right text-[11px] leading-relaxed text-ink-soft">{help}</p>}
    </div>
  );
}
