"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  phoneToEmail,
  registrationRequiresReferral,
  referralCodeExists,
} from "@/lib/app-data";
import { DIAL_CODE } from "@/lib/types";
import { useApp } from "./AppContext";
import { IconEye, IconEyeOff, IconGift, IconGlobe, IconInfo, IconLock } from "./Icons";
import { LanguageSheet } from "./LanguageSheet";

type AuthTab = "login" | "register";

function digitsOnly(value: string) {
  return value.replace(/\D/g, "").slice(0, 12);
}

export function AuthScreen() {
  const { route, navigate, toast, configError } = useApp();
  const inviteFromUrl = route.params.get("inviteCode") ?? route.params.get("invite");
  const initialTab: AuthTab = route.path.includes("reset") || route.path.includes("register") || inviteFromUrl ? "register" : "login";
  const tab = initialTab;
  const [langOpen, setLangOpen] = useState(false);

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [invite, setInvite] = useState(inviteFromUrl ?? "");
  const [requiresInvite, setRequiresInvite] = useState<boolean | null>(null);
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "register" || configError) return;
    let active = true;
    registrationRequiresReferral(getSupabaseBrowserClient())
      .then((required) => {
        if (active) setRequiresInvite(required);
      })
      .catch(() => {
        if (active) setError("Could not check invitation requirements. Please try again.");
      });
    return () => {
      active = false;
    };
  }, [tab, configError]);

  function switchTab(next: AuthTab) {
    setError(null);
    navigate(next === "register" ? "/register" : "/");
  }

  const visibleError = error ?? configError;

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!phone.trim()) {
      setError("Enter your phone number.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    try {
      const client = getSupabaseBrowserClient();
      const { error: authError } = await client.auth.signInWithPassword({
        email: phoneToEmail(DIAL_CODE, phone),
        password,
      });
      if (authError) throw new Error("Incorrect phone number or password.");
      if (!remember) {
        window.addEventListener("beforeunload", () => {
          void client.auth.signOut();
        });
      }
      navigate("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (phone.trim().length < 9) {
      setError("Enter a valid phone number.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== password2) {
      setError("The two passwords do not match.");
      return;
    }
    if (requiresInvite === null) {
      setError("Checking invitation requirements. Please wait.");
      return;
    }
    if (requiresInvite && !invite.trim()) {
      setError("Enter your invitation code.");
      return;
    }
    setBusy(true);
    try {
      const client = getSupabaseBrowserClient();
      const code = invite.trim().toLowerCase();
      const required = await registrationRequiresReferral(client);
      setRequiresInvite(required);
      if (required && !code) throw new Error("An invitation code is required.");
      if (code && !(await referralCodeExists(client, code))) {
        throw new Error("Invitation code is invalid.");
      }

      const { data, error: authError } = await client.auth.signUp({
        email: phoneToEmail(DIAL_CODE, phone),
        password,
        options: {
          data: {
            phone: `${DIAL_CODE}${phone}`,
            invite_code: code || null,
          },
        },
      });
      if (authError) {
        const message = authError.message.toLowerCase();
        if (message.includes("already")) throw new Error("This number is already registered.");
        if (message.includes("invitation code")) throw new Error(authError.message);
        if (message.includes("database error") || message.includes("saving new user")) {
          throw new Error("Account setup failed while saving your profile. Confirm the Supabase migrations and auth profile trigger are installed, then check Supabase Auth logs.");
        }
        throw new Error(authError.message || `Registration failed (HTTP ${authError.status ?? 400}).`);
      }
      if (!data.user?.id) throw new Error("Registration failed. Try again.");

      toast("Account created. Sign in to continue.");
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <Image
        src="/images/app/auth-hero.jpg"
        alt=""
        fill
        priority
        className="object-cover"
        sizes="480px"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/10" />

      <button
        type="button"
        onClick={() => setLangOpen(true)}
        className="absolute right-2.5 top-3 z-20 inline-flex h-[37px] items-center gap-1.5 rounded-xl bg-white px-5 text-base text-primary shadow-[0_2px_8px_rgba(0,30,90,0.18)]"
      >
        <IconGlobe width={17} height={17} />
        Language
      </button>

      <div className="relative py-3 z-10 flex min-h-screen flex-col justify-end">
        <div className="mx-[13px] mb-[13px] mt-[42vh]">
          <div className="rounded-[28px] border border-white/60 px-[21.5px] pb-[23px] pt-[31px] text-ink shadow-[0_18px_44px_-18px_rgba(10,50,140,0.45)] backdrop-blur-md"
            style={{
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.72) 45%, rgba(255,255,255,0.94) 100%)",
            }}
          >
            {tab === "login" ? (
              <form onSubmit={handleLogin} noValidate>
                <h1 className="m-0 text-[26px] font-bold tracking-tight text-ink">Login</h1>
                <FieldRow
                  icon={<span className="text-[17px] font-bold text-primary">{DIAL_CODE}</span>}
                  input={
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="Enter Username Number"
                      value={phone}
                      onChange={(e) => setPhone(digitsOnly(e.target.value))}
                      className="w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
                    />
                  }
                />
                <FieldRow
                  icon={<IconLock width={21} height={21} className="text-primary" />}
                  input={
                    <input
                      type={showPw ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="Enter password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
                    />
                  }
                  trailing={
                    <button
                      type="button"
                      aria-label={showPw ? "Hide password" : "Show password"}
                      onClick={() => setShowPw((v) => !v)}
                      className="text-muted transition-colors hover:text-primary"
                    >
                      {showPw ? <IconEyeOff width={21} height={21} /> : <IconEye width={21} height={21} />}
                    </button>
                  }
                />
                <AuthButton busy={busy} label={busy ? "Please wait..." : "Login"} />
                <p className="mb-0 mt-[15px] text-center">
                  <button
                    type="button"
                    onClick={() => switchTab("register")}
                    className="bg-transparent text-[14px] font-medium text-primary"
                  >
                    New here? Create Account
                  </button>
                </p>
                <label className="mt-[13px] flex select-none items-center justify-center gap-2 text-[13px] text-ink-soft">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  Remember me
                </label>
                {visibleError && <AuthError text={visibleError} />}
              </form>
            ) : (
              <form onSubmit={handleRegister} noValidate>
                <h1 className="m-0 text-[26px] font-bold tracking-tight text-ink">Create Account</h1>
                <FieldRow
                  icon={<span className="text-[17px] font-bold text-primary">{DIAL_CODE}</span>}
                  input={
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="Enter Username Number"
                      value={phone}
                      onChange={(e) => setPhone(digitsOnly(e.target.value))}
                      className="w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
                    />
                  }
                />
                <FieldRow
                  icon={<IconLock width={21} height={21} className="text-primary" />}
                  input={
                    <input
                      type={showPw ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Please new password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
                    />
                  }
                  trailing={
                    <button
                      type="button"
                      aria-label={showPw ? "Hide password" : "Show password"}
                      onClick={() => setShowPw((v) => !v)}
                      className="text-muted transition-colors hover:text-primary"
                    >
                      {showPw ? <IconEyeOff width={21} height={21} /> : <IconEye width={21} height={21} />}
                    </button>
                  }
                />
                <FieldRow
                  icon={<IconLock width={21} height={21} className="text-primary" />}
                  input={
                    <input
                      type={showPw2 ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Please new password again"
                      value={password2}
                      onChange={(e) => setPassword2(e.target.value)}
                      className="w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
                    />
                  }
                  trailing={
                    <button
                      type="button"
                      aria-label={showPw2 ? "Hide password" : "Show password"}
                      onClick={() => setShowPw2((v) => !v)}
                      className="text-muted transition-colors hover:text-primary"
                    >
                      {showPw2 ? <IconEyeOff width={21} height={21} /> : <IconEye width={21} height={21} />}
                    </button>
                  }
                />
                <FieldRow
                  icon={<IconGift width={21} height={21} className="text-primary" />}
                  input={
                    <input
                      type="text"
                      autoComplete="off"
                      maxLength={12}
                      placeholder={requiresInvite === false ? "Invitation code (optional)" : "Enter invitation code"}
                      value={invite}
                      onChange={(e) => setInvite(e.target.value.trim())}
                      required={requiresInvite === true}
                      className="w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
                    />
                  }
                />
                <AuthButton busy={busy} disabled={requiresInvite === null} label={busy ? "Please wait..." : "REGISTER"} />
                <p className="mb-0 mt-2 text-center text-[11px] text-muted">
                  {requiresInvite === null
                    ? "Checking invitation requirements..."
                    : requiresInvite
                      ? "An invitation code is required to join."
                      : "The first member can register without an invitation code."}
                </p>
                <p className="mb-0 mt-[15px] text-center">
                  <button
                    type="button"
                    onClick={() => switchTab("login")}
                    className="bg-transparent text-[14px] font-medium text-primary"
                  >
                    I already have an account
                  </button>
                </p>
                {visibleError && <AuthError text={visibleError} />}
              </form>
            )}
            <div className="mt-4 border-t border-primary/15 pt-3 text-center">
              <p className="m-0 text-[11px] leading-relaxed text-ink-soft">Respectful HIV awareness. Testing is voluntary, and medical information is private.</p>
              <button
                type="button"
                onClick={() => navigate("/about")}
                className="mt-2 inline-flex items-center gap-1.5 bg-transparent text-[12px] font-bold text-primary"
              >
                <IconInfo width={15} height={15} /> About Testing Lives
              </button>
            </div>
          </div>
        </div>
      </div>

      {langOpen && <LanguageSheet onClose={() => setLangOpen(false)} />}
    </div>
  );
}

function FieldRow({
  icon,
  input,
  trailing,
}: {
  icon: React.ReactNode;
  input: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="mt-[3px] flex h-[46px] items-center gap-2.5 border-b-[1.5px] border-primary/40 pt-[13px]">
      <span className="flex w-[42px] shrink-0 items-center justify-start">{icon}</span>
      <span className="flex min-w-0 flex-1 items-center">{input}</span>
      {trailing}
    </div>
  );
}

function AuthButton({ busy, disabled = false, label }: { busy: boolean; disabled?: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="mt-[19.8px] h-[46px] w-full rounded-[20px] bg-gradient-to-br from-[#0a56e3] via-[#2f72ea] to-[#5b91ee] text-[16px] font-bold tracking-wide text-white shadow-[0_10px_22px_-10px_rgba(7,80,200,0.8)] transition-transform active:scale-[0.98]"
    >
      {label}
    </button>
  );
}

function AuthError({ text }: { text: string }) {
  return (
    <p className="mt-3 rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-center text-[13px] text-danger">
      {text}
    </p>
  );
}
