"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import type { CommunityLinks, Investment, PaymentProvider, PendingWithdrawal, TeamMember, Transaction } from "@/lib/types";
import {
  approveWithdrawal,
  claimDailyIncome,
  daysElapsed,
  fetchCommunityLinks,
  fetchAdminTransactions,
  fetchInvestments,
  fetchPendingWithdrawals,
  fetchTeam,
  fetchTransactions,
  formatDate,
  formatMoney,
  rejectWithdrawal,
  requestDeposit,
  requestWithdrawal,
  saveCommunityLinks,
  submitTestCompletion,
} from "@/lib/app-data";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { detectUgandaMobileProvider, normalizeUgandaPhone } from "@/lib/phone";
import { useApp } from "./AppContext";
import { InstallAppButton } from "./InstallAppButton";
import {
  IconBack,
  IconClock,
  IconCopy,
  IconChevronRight,
  IconInfo,
  IconLogout,
  IconRefresh,
  IconRecords,
  IconTeam,
} from "./Icons";

export function MemberPages({ path }: { path: string }) {
  switch (path) {
    case "/income":
      return <IncomePage />;
    case "/team":
      return <TeamPage />;
    case "/share":
      return <SharePage />;
    case "/account":
      return <AccountPage />;
    case "/admin":
      return <AdminDashboardPage />;
    case "/deposit":
      return <DepositPage />;
    case "/withdraw":
      return <WithdrawPage />;
    case "/admin/withdrawals":
      return <AdminWithdrawalsPage />;
    case "/admin/settings":
      return <AdminSettingsPage />;
    case "/admin/transactions":
      return <AdminTransactionsPage />;
    case "/records":
      return <RecordsPage />;
    case "/announce":
    case "/about":
      return <AboutPage />;
    default:
      return <PageFrame title="Page"><EmptyMessage>That page is not available.</EmptyMessage></PageFrame>;
  }
}

function PageFrame({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const { navigate } = useApp();
  return (
    <main className="min-h-screen bg-page pb-24">
      <header className="flex items-center gap-3 border-b border-line-blue/60 bg-white px-4 pb-4 pt-5">
        <button type="button" onClick={() => navigate("/home")} className="grid h-9 w-9 place-items-center rounded-full bg-page text-ink" aria-label="Back to home">
          <IconBack />
        </button>
        <div>
          <p className="m-0 text-[11px] font-semibold uppercase text-primary">Testing Lives</p>
          <h1 className="m-0 mt-0.5 text-[20px] font-bold text-ink">{title}</h1>
        </div>
        {action}
      </header>
      <div className="space-y-4 px-4 py-4">{children}</div>
    </main>
  );
}

function Panel({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line-blue/60 bg-white p-4 shadow-[0_2px_10px_rgba(30,50,120,0.05)]">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="m-0 text-[15px] font-bold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return <p className="m-0 rounded-lg bg-page px-3 py-4 text-center text-[13px] text-muted">{children}</p>;
}

function PageError({ message }: { message: string }) {
  return <p role="alert" className="m-0 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{message}</p>;
}

function PageButton({ children, disabled = false, onClick, type = "button" }: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} disabled={disabled} onClick={onClick} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-bold text-white disabled:bg-muted">
      {children}
    </button>
  );
}

function Field({ label, ...inputProps }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-[12px] font-semibold text-ink-soft">
      {label}
      <input {...inputProps} className="mt-1.5 h-11 w-full rounded-lg border border-line-blue bg-white px-3 text-[14px] text-ink outline-none focus:border-primary" />
    </label>
  );
}

function referralUrl(code: string) {
  return `${window.location.origin}/register?inviteCode=${encodeURIComponent(code)}`;
}

function ReferralCodePanel() {
  const { profile, toast } = useApp();
  const code = profile?.referral_code ?? "";

  async function copyLink() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(referralUrl(code));
      toast("Invitation link copied.");
    } catch {
      toast("Could not copy the link on this device.", "error");
    }
  }

  return (
    <Panel title="Your invitation code">
      <div className="flex items-center justify-between gap-3 rounded-lg bg-page px-3 py-3">
        <span className="font-mono text-[17px] font-bold tracking-[0.08em] text-primary">{code || "Loading..."}</span>
        <button type="button" onClick={copyLink} disabled={!code} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-primary" aria-label="Copy invitation link" title="Copy invitation link">
          <IconCopy />
        </button>
      </div>
      <p className="mb-0 mt-3 text-[12px] leading-relaxed text-muted">Separate referral program: a 15% plan-price reward is credited after a referred member reports a completed test and it is verified. The reward never depends on HIV status or results. Testing is voluntary; never request or share someone&apos;s results.</p>
      <PageButton onClick={copyLink}><IconCopy width={17} height={17} /> Copy invite link</PageButton>
    </Panel>
  );
}

function IncomePage() {
  const { user, refreshProfile, toast } = useApp();
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadInvestments() {
    if (!user) return;
    setLoading(true);
    try {
      setInvestments(await fetchInvestments(getSupabaseBrowserClient(), user.id));
      setError(null);
    } catch {
      setError("Your test plans could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    let active = true;
    fetchInvestments(getSupabaseBrowserClient(), user.id)
      .then((items) => { if (active) { setInvestments(items); setError(null); } })
      .catch(() => { if (active) setError("Your test plans could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  async function claim(investment: Investment) {
    setClaiming(investment.id);
    try {
      const amount = await claimDailyIncome(getSupabaseBrowserClient(), investment.id);
      await refreshProfile();
      await loadInvestments();
      toast(`UGX ${formatMoney(amount)} added to your balance.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Earnings could not be claimed.", "error");
    } finally {
      setClaiming(null);
    }
  }

  async function reportTest(investment: Investment) {
    setReporting(investment.id);
    try {
      await submitTestCompletion(getSupabaseBrowserClient(), investment.id);
      await loadInvestments();
      toast("Test completion submitted for verification.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Test completion could not be submitted.", "error");
    } finally {
      setReporting(null);
    }
  }

  const dailyTotal = investments.filter((item) => item.status === "active").reduce((total, item) => total + item.daily_income, 0);

  return (
    <PageFrame title="Daily earnings">
      <Panel>
        <p className="m-0 text-[12px] font-medium text-ink-soft">Potential daily earnings</p>
        <p className="m-0 mt-1 text-[25px] font-extrabold text-primary">UGX {formatMoney(dailyTotal)}</p>
        <p className="m-0 mt-1 text-[11px] text-muted">Across your active test plans</p>
      </Panel>
      {error && <PageError message={error} />}
      <Panel title="Your test plans" action={<button onClick={() => { setLoading(true); void loadInvestments(); }} type="button" aria-label="Refresh test plans" className="text-primary"><IconRefresh /></button>}>
        {loading ? <EmptyMessage>Loading your plans...</EmptyMessage> : investments.length === 0 ? <EmptyMessage>No test plans yet. Choose a plan from Home to begin.</EmptyMessage> : (
          <div className="space-y-3">
            {investments.map((investment) => {
              const elapsed = daysElapsed(investment.started_at, investment.ends_at);
              const availableDays = Math.max(0, Math.min(investment.duration_days, elapsed) - investment.claimed_days);
              const remaining = Math.max(0, investment.duration_days - investment.claimed_days);
              return (
                <article key={investment.id} className="rounded-lg border border-line-blue/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="m-0 text-[14px] font-bold text-ink">{investment.product?.name ?? "Test plan"}</h3>
                      <p className="m-0 mt-1 text-[11px] text-muted">UGX {formatMoney(investment.amount)} · {investment.duration_days} days</p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${investment.status === "active" ? "bg-success/10 text-success" : "bg-page text-muted"}`}>
                      {investment.status === "active" ? "Active" : "Completed"}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                    <p className="m-0 text-muted">Daily <span className="font-semibold text-success">UGX {formatMoney(investment.daily_income)}</span></p>
                    <p className="m-0 text-right text-muted">Days remaining <span className="font-semibold text-ink">{remaining}</span></p>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-line-blue/50 pt-3">
                    <span className="text-[11px] text-muted">{availableDays > 0 ? `${availableDays} day(s) ready` : "Next earnings unlock after 24 hours"}</span>
                    <PageButton disabled={availableDays < 1 || claiming === investment.id} onClick={() => void claim(investment)}>
                      {claiming === investment.id ? "Claiming..." : `Claim ${availableDays > 0 ? `UGX ${formatMoney(availableDays * investment.daily_income)}` : ""}`}
                    </PageButton>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-line-blue/50 pt-3">
                    <span className="text-[11px] text-muted">
                      Test: {investment.test_status === "approved" ? "verified" : investment.test_status === "pending" ? "awaiting verification" : investment.test_status === "rejected" ? "verification needed" : "not reported"}
                    </span>
                    {investment.test_status !== "approved" && investment.test_status !== "pending" && (
                      <PageButton disabled={reporting === investment.id} onClick={() => void reportTest(investment)}>
                        {reporting === investment.id ? "Submitting..." : "Report test done"}
                      </PageButton>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </PageFrame>
  );
}

function TeamPage() {
  const { user } = useApp();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [earned, setEarned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const client = getSupabaseBrowserClient();
        const [team, transactions] = await Promise.all([fetchTeam(client), fetchTransactions(client, user.id)]);
        if (!active) return;
        setMembers(team);
        setEarned(transactions.filter((transaction) => transaction.kind === "rebate" && transaction.status === "approved").reduce((sum, transaction) => sum + transaction.amount, 0));
      } catch {
        if (active) setError("Your referral activity could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [user]);

  return (
    <PageFrame title="Referral team">
      <div className="grid grid-cols-2 gap-3">
        <Panel><p className="m-0 text-[11px] text-muted">Referred members</p><p className="m-0 mt-1 text-[22px] font-bold text-ink">{members.length}</p></Panel>
        <Panel><p className="m-0 text-[11px] text-muted">Referral earnings</p><p className="m-0 mt-1 text-[17px] font-bold text-success">UGX {formatMoney(earned)}</p></Panel>
      </div>
      <ReferralCodePanel />
      {error && <PageError message={error} />}
      <Panel title="People you invited">
        {loading ? <EmptyMessage>Loading your team...</EmptyMessage> : members.length === 0 ? <EmptyMessage>No one has joined from your code yet.</EmptyMessage> : (
          <div className="divide-y divide-line-blue/50">
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card-blue text-primary"><IconTeam width={18} height={18} /></span>
                  <div className="min-w-0"><p className="m-0 truncate text-[13px] font-semibold text-ink">{member.phone}</p><p className="m-0 mt-0.5 text-[10px] text-muted">Joined {formatDate(member.created_at)}</p></div>
                </div>
                <span className="shrink-0 text-[11px] font-semibold text-ink">UGX {formatMoney(member.invested)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <p className="m-0 text-[11px] leading-relaxed text-muted">Referral rewards are part of a separate, disclosed program. The reward is not based on HIV status or test results, which remain private.</p>
    </PageFrame>
  );
}

function SharePage() {
  return (
    <PageFrame title="Referrals and awareness">
      <div className="relative aspect-[3/5] overflow-hidden rounded-xl bg-primary">
        <Image src="/images/referral-earnings.jpg" alt="Earn a disclosed 15% referral reward after your invited member completes a test and it is verified" fill priority className="object-contain" sizes="448px" />
      </div>
      <ReferralCodePanel />
      <Panel title="Share awareness">
        <ol className="m-0 space-y-3 pl-5 text-[13px] leading-relaxed text-ink-soft">
          <li>Encourage friends and relatives to learn about HIV testing and qualified healthcare providers.</li>
          <li>Share your personal invitation link if they choose to join the separate referral program.</li>
          <li>Any 15% reward terms are disclosed separately and do not depend on HIV status or test results.</li>
        </ol>
        <p className="mb-0 mt-4 text-[12px] leading-relaxed text-muted">Testing must remain voluntary. Never ask someone to disclose their results to you.</p>
      </Panel>
    </PageFrame>
  );
}

function AccountPage() {
  const { user, profile, language, setLanguage, toast, navigate } = useApp();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const { error } = await getSupabaseBrowserClient().auth.signOut();
    if (error) toast("Could not sign out. Try again.", "error");
    setBusy(false);
  }

  return (
    <PageFrame
      title="My account"
      action={user?.app_metadata?.role === "admin" ? (
        <button type="button" onClick={() => navigate("/admin")} className="ml-auto rounded-lg bg-primary px-3 py-2 text-[12px] font-bold text-white">
          Admin
        </button>
      ) : null}
    >
      <Panel>
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-primary text-white"><IconTeam /></span>
          <div><p className="m-0 text-[15px] font-bold text-ink">{profile?.phone ?? "Member"}</p><p className="m-0 mt-1 text-[11px] text-muted">Member since {profile?.created_at ? formatDate(profile.created_at) : "—"}</p></div>
        </div>
      </Panel>
      <Panel title="Balance">
        <p className="m-0 text-[24px] font-extrabold text-primary">UGX {formatMoney(profile?.balance ?? 0)}</p>
        <p className="mb-0 mt-1 text-[11px] text-muted">Available for test plans and withdrawals</p>
      </Panel>
      <ReferralCodePanel />
      <button type="button" onClick={() => navigate("/about")} className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-line-blue/60 bg-white px-4 text-left text-[14px] font-medium text-ink shadow-[0_2px_10px_rgba(30,50,120,0.05)]">
        <IconInfo width={20} height={20} className="shrink-0 text-primary" />
        <span className="flex-1">About Testing Lives</span>
        <IconChevronRight className="text-muted" />
      </button>
      <Panel title="Preferences">
        <label className="flex items-center justify-between gap-3 text-[13px] font-medium text-ink">
          App language
          <select value={language} onChange={(event) => setLanguage(event.target.value)} className="h-10 rounded-lg border border-line-blue bg-white px-2 text-[12px]">
            <option>English</option><option>Kiswahili</option><option>Luganda</option><option>Français</option><option>العربية</option>
          </select>
        </label>
      </Panel>
      <Panel title="Install app">
        <p className="mb-3 mt-0 text-[12px] leading-relaxed text-muted">Add Testing Lives to your home screen for quick access.</p>
        <InstallAppButton className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-bold text-white disabled:cursor-default disabled:opacity-70" />
      </Panel>
      <PageButton disabled={busy} onClick={() => void signOut()}><IconLogout width={17} height={17} /> {busy ? "Signing out..." : "Sign out"}</PageButton>
      <p className="m-0 text-center text-[10px] text-muted">{user?.email}</p>
    </PageFrame>
  );
}

function AdminDashboardPage() {
  const { user, navigate } = useApp();
  const isAdmin = user?.app_metadata?.role === "admin";
  if (!isAdmin) {
    return <PageFrame title="Admin dashboard"><PageError message="Administrator access is required." /></PageFrame>;
  }

  return (
    <PageFrame title="Admin dashboard">
      <Panel>
        <p className="m-0 text-[13px] leading-relaxed text-ink-soft">Manage member payouts, community links, and transaction records.</p>
      </Panel>
      <button type="button" onClick={() => navigate("/admin/withdrawals")} className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-line-blue/60 bg-white px-4 text-left text-[14px] font-medium text-ink shadow-[0_2px_10px_rgba(30,50,120,0.05)]">
        <IconClock width={20} height={20} className="shrink-0 text-primary" />
        <span className="flex-1">Payout review</span>
        <IconChevronRight className="text-muted" />
      </button>
      <button type="button" onClick={() => navigate("/admin/settings")} className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-line-blue/60 bg-white px-4 text-left text-[14px] font-medium text-ink shadow-[0_2px_10px_rgba(30,50,120,0.05)]">
        <IconInfo width={20} height={20} className="shrink-0 text-primary" />
        <span className="flex-1">Community settings</span>
        <IconChevronRight className="text-muted" />
      </button>
      <button type="button" onClick={() => navigate("/admin/transactions")} className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-line-blue/60 bg-white px-4 text-left text-[14px] font-medium text-ink shadow-[0_2px_10px_rgba(30,50,120,0.05)]">
        <IconRecords width={20} height={20} className="shrink-0 text-primary" />
        <span className="flex-1">All transactions</span>
        <IconChevronRight className="text-muted" />
      </button>
    </PageFrame>
  );
}

function validateTelegramUrl(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:"
      || !["t.me", "telegram.me"].includes(url.hostname.toLowerCase())
      || url.pathname === "/"
    ) {
      throw new Error();
    }
    return url.toString();
  } catch {
    throw new Error(`${label} must be an HTTPS Telegram link, such as https://t.me/your_group.`);
  }
}

function AdminSettingsPage() {
  const { user, toast } = useApp();
  const isAdmin = user?.app_metadata?.role === "admin";
  const [links, setLinks] = useState<CommunityLinks>({ serviceChatUrl: "", telegramGroupUrl: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    fetchCommunityLinks(getSupabaseBrowserClient())
      .then((value) => { if (active) setLinks(value); })
      .catch(() => { if (active) setError("Community settings could not be loaded. Apply the community settings database migration and try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAdmin]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const nextLinks = {
        serviceChatUrl: validateTelegramUrl(links.serviceChatUrl, "Service chat URL"),
        telegramGroupUrl: validateTelegramUrl(links.telegramGroupUrl, "Telegram group URL"),
      };
      await saveCommunityLinks(getSupabaseBrowserClient(), nextLinks);
      setLinks(nextLinks);
      toast("Community links saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Community links could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return <PageFrame title="Community settings"><PageError message="Administrator access is required." /></PageFrame>;
  }

  return (
    <PageFrame title="Community settings">
      <Panel title="Telegram links">
        {loading ? (
          <EmptyMessage>Loading community settings...</EmptyMessage>
        ) : (
          <form onSubmit={(event) => void save(event)} className="space-y-4">
            <Field
              label="Service chat URL"
              type="url"
              inputMode="url"
              placeholder="https://t.me/your_support_account"
              value={links.serviceChatUrl}
              onChange={(event) => setLinks((current) => ({ ...current, serviceChatUrl: event.target.value }))}
            />
            <Field
              label="Telegram group URL"
              type="url"
              inputMode="url"
              placeholder="https://t.me/your_group"
              value={links.telegramGroupUrl}
              onChange={(event) => setLinks((current) => ({ ...current, telegramGroupUrl: event.target.value }))}
            />
            <p className="m-0 text-[12px] leading-relaxed text-muted">These links appear as the Service and Group actions on the home page. Use HTTPS links from t.me or telegram.me; blank links remain unavailable until configured.</p>
            {error && <PageError message={error} />}
            <PageButton type="submit" disabled={busy || loading}>{busy ? "Saving..." : "Save links"}</PageButton>
          </form>
        )}
      </Panel>
    </PageFrame>
  );
}

function DepositPage() {
  const { profile, toast, navigate } = useApp();
  const [amount, setAmount] = useState("");
  const [phoneOverride, setPhoneOverride] = useState<string | null>(null);
  const [provider, setProvider] = useState<PaymentProvider | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phone = phoneOverride ?? profile?.phone ?? "";
  const normalizedPhone = normalizeUgandaPhone(phone);
  const detectedProvider = normalizedPhone ? detectUgandaMobileProvider(normalizedPhone) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 10000) {
      setError("The minimum deposit is UGX 10,000.");
      return;
    }
    if (!phone.trim()) {
      setError("Enter the phone number that should receive the payment prompt.");
      return;
    }
    if (!normalizedPhone) {
      setError("Enter a valid Uganda mobile number.");
      return;
    }
    const selectedProvider = detectedProvider ?? provider;
    if (!selectedProvider) {
      setError("Select the mobile money network for this number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestDeposit(value, phone, selectedProvider);
      setAmount("");
      toast(`Payment prompt sent to ${phone}. Approve it on that phone to complete your deposit.`);
      navigate("/records");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit request could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageFrame title="Deposit">
      <Panel title="Add funds">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Amount (UGX)" type="number" min="10000" step="1000" inputMode="numeric" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="10,000" />
          <Field label="Phone number" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(event) => { setPhoneOverride(event.target.value); setProvider(""); }} placeholder="+256 7XX XXX XXX" />
          {normalizedPhone && !detectedProvider && (
            <NetworkSelector value={provider} onChange={setProvider} />
          )}
          <p className="m-0 text-[12px] text-muted">Minimum deposit: <strong className="text-ink">UGX 10,000</strong>. Approve the prompt on this phone. Your balance updates when payment is confirmed.</p>
          {error && <PageError message={error} />}
          <PageButton type="submit" disabled={busy}>{busy ? "Sending prompt..." : "Send payment prompt"}</PageButton>
        </form>
      </Panel>
      <Panel title="What happens next">
        <p className="m-0 text-[13px] leading-relaxed text-ink-soft">A payment prompt will be sent to the number you entered. Approve it on your phone; the deposit will appear in your balance after confirmation.</p>
      </Panel>
    </PageFrame>
  );
}

function WithdrawPage() {
  const { profile, refreshProfile, toast } = useApp();
  const [amount, setAmount] = useState("");
  const [phoneOverride, setPhoneOverride] = useState<string | null>(null);
  const [provider, setProvider] = useState<PaymentProvider | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phone = phoneOverride ?? profile?.phone ?? "";
  const normalizedPhone = normalizeUgandaPhone(phone);
  const detectedProvider = normalizedPhone ? detectUgandaMobileProvider(normalizedPhone) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 5000) { setError("The minimum withdrawal is UGX 5,000."); return; }
    if (!phone.trim()) { setError("Enter the phone number where you want to receive your withdrawal."); return; }
    if (!normalizedPhone) { setError("Enter a valid Uganda mobile number."); return; }
    const selectedProvider = detectedProvider ?? provider;
    if (!selectedProvider) { setError("Select the mobile money network for this number."); return; }
    setBusy(true);
    setError(null);
    try {
      await requestWithdrawal(value, phone, selectedProvider);
      await refreshProfile();
      setAmount("");
      toast("Withdrawal request submitted. It is pending admin approval.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal request could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  const gross = Number(amount) || 0;
  const fee = gross * 0.2;
  const payout = gross - fee;

  return (
    <PageFrame title="Withdraw">
      <Panel>
        <p className="m-0 text-[11px] text-muted">Available balance</p>
        <p className="m-0 mt-1 text-[24px] font-extrabold text-primary">UGX {formatMoney(profile?.balance ?? 0)}</p>
      </Panel>
      <Panel title="Withdrawal amount">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Phone number to receive payment" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(event) => { setPhoneOverride(event.target.value); setProvider(""); }} placeholder="+256 7XX XXX XXX" />
          {normalizedPhone && !detectedProvider && (
            <NetworkSelector value={provider} onChange={setProvider} />
          )}
          <Field label="Amount (UGX)" type="number" min="5000" step="1000" inputMode="numeric" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="5,000" />
          <div className="space-y-2 rounded-lg bg-page p-3 text-[12px]">
            <p className="m-0 flex justify-between text-muted"><span>Withdrawal fee (20%)</span><span>UGX {formatMoney(fee)}</span></p>
            <p className="m-0 flex justify-between font-semibold text-ink"><span>You receive</span><span>UGX {formatMoney(payout)}</span></p>
          </div>
          <p className="m-0 flex items-center gap-2 text-[11px] text-muted"><IconClock width={16} height={16} /> Requests are accepted 9:00 AM–9:00 PM Kampala time. Minimum UGX 5,000.</p>
          <p className="m-0 text-[12px] leading-relaxed text-muted">Your wallet amount is reserved while an admin reviews your request. After approval, payment is sent to the number above. If payment fails, the reserved amount is refunded.</p>
          {error && <PageError message={error} />}
          <PageButton type="submit" disabled={busy}>{busy ? "Submitting..." : "Request withdrawal"}</PageButton>
        </form>
      </Panel>
    </PageFrame>
  );
}

function NetworkSelector({
  value,
  onChange,
}: {
  value: PaymentProvider | "";
  onChange: (provider: PaymentProvider | "") => void;
}) {
  return (
    <label className="block text-[12px] font-semibold text-ink-soft">
      Mobile money network
      <select
        required
        value={value}
        onChange={(event) => {
          const selected = event.target.value;
          if (selected === "mtn" || selected === "airtel" || selected === "") onChange(selected);
        }}
        className="mt-1.5 h-11 w-full rounded-lg border border-line-blue bg-white px-3 text-[14px] text-ink outline-none focus:border-primary"
      >
        <option value="">Select a network</option>
        <option value="mtn">MTN Mobile Money</option>
        <option value="airtel">Airtel Money</option>
      </select>
    </label>
  );
}

function AdminWithdrawalsPage() {
  const { user, toast } = useApp();
  const isAdmin = user?.app_metadata?.role === "admin";
  const [requests, setRequests] = useState<PendingWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    fetchPendingWithdrawals(getSupabaseBrowserClient())
      .then((rows) => { if (active) { setRequests(rows); setError(null); } })
      .catch(() => { if (active) setError("The payout queue could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAdmin]);

  async function review(request: PendingWithdrawal, approve: boolean) {
    setActiveId(request.id);
    setError(null);
    try {
      const result = approve
        ? await approveWithdrawal(request.id)
        : await rejectWithdrawal(request.id);
      toast(approve
        ? result.status === "COMPLETED"
          ? "Withdrawal approved and payment completed."
          : "Withdrawal approved. Payment is processing."
        : "Withdrawal declined and reserved funds refunded.");
      setRequests(await fetchPendingWithdrawals(getSupabaseBrowserClient()));
    } catch (err) {
      const message = err instanceof Error ? err.message : "The payout request could not be reviewed.";
      setError(message);
      toast(message, "error");
    } finally {
      setActiveId(null);
    }
  }

  if (!isAdmin) {
    return <PageFrame title="Withdrawal review"><PageError message="Administrator access is required." /></PageFrame>;
  }

  return (
    <PageFrame title="Withdrawal review">
      <Panel title="Pending withdrawals" action={<button type="button" onClick={() => { setLoading(true); void fetchPendingWithdrawals(getSupabaseBrowserClient()).then(setRequests).catch(() => setError("The payout queue could not be loaded.")).finally(() => setLoading(false)); }} aria-label="Refresh payout queue" className="text-primary"><IconRefresh /></button>}>
        {error && <PageError message={error} />}
        {loading ? <EmptyMessage>Loading payout requests...</EmptyMessage> : requests.length === 0 ? <EmptyMessage>No withdrawals need review.</EmptyMessage> : (
          <div className="space-y-3">
            {requests.map((request) => (
              <article key={request.id} className="rounded-lg border border-line-blue/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="m-0 text-[13px] font-bold text-ink">{request.payment_phone}</p>
                    <p className="m-0 mt-1 text-[11px] text-muted">{request.member_phone} · {formatDate(request.created_at)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${request.status === "processing" ? "bg-wait/15 text-wait" : "bg-page text-muted"}`}>
                    {request.status === "processing" ? "Payout processing" : "Awaiting approval"}
                  </span>
                </div>
                <dl className="mb-0 mt-3 space-y-1.5 text-[12px]">
                  <div className="flex justify-between"><dt className="text-muted">Requested</dt><dd className="m-0 font-semibold text-ink">UGX {formatMoney(request.amount)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Fee</dt><dd className="m-0 text-ink">UGX {formatMoney(request.fee ?? 0)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Payment amount</dt><dd className="m-0 font-bold text-primary">UGX {formatMoney(request.net_amount ?? 0)}</dd></div>
                </dl>
                {request.failure_reason && <p className="mb-0 mt-2 text-[11px] text-danger">Payment failure: {request.failure_reason}</p>}
                <div className="mt-3 flex gap-2 border-t border-line-blue/50 pt-3">
                  <PageButton disabled={activeId === request.id} onClick={() => void review(request, true)}>
                    {activeId === request.id ? "Working..." : request.status === "processing" ? "Retry payment" : "Approve & pay"}
                  </PageButton>
                  {request.status === "pending" && (
                    <button type="button" disabled={activeId === request.id} onClick={() => void review(request, false)} className="min-h-10 rounded-lg border border-danger/30 px-3 py-2 text-[12px] font-semibold text-danger disabled:opacity-50">Decline</button>
                  )}
                </div>
                {request.status === "processing" && <p className="mb-0 mt-2 text-[10px] leading-relaxed text-muted">Retry continues the original payment request.</p>}
              </article>
            ))}
          </div>
        )}
      </Panel>
    </PageFrame>
  );
}

function RecordsPage() {
  const { user, profile } = useApp();
  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    fetchTransactions(getSupabaseBrowserClient(), user.id, 0, 100)
      .then((transactions) => {
        if (active) {
          setItems(transactions);
          setHasMore(transactions.length === 100);
        }
      })
      .catch(() => { if (active) setError("Transactions could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  async function loadMore() {
    if (!user) return;
    setLoadingMore(true);
    setError(null);
    try {
      const transactions = await fetchTransactions(getSupabaseBrowserClient(), user.id, items.length, 100);
      setItems((current) => [...current, ...transactions]);
      setHasMore(transactions.length === 100);
    } catch {
      setError("More transactions could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <PageFrame title="Records">
      <Panel title="Recent activity" action={<IconRecords className="text-primary" width={19} height={19} />}>
        {error && <PageError message={error} />}
        {loading ? <EmptyMessage>Loading records...</EmptyMessage> : items.length === 0 ? <EmptyMessage>No transactions yet.</EmptyMessage> : (
          <div className="divide-y divide-line-blue/50">
            {items.map((item) => (
              <article key={item.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="m-0 truncate text-[13px] font-semibold capitalize text-ink">{item.note ?? item.kind}</p>
                  <p className="m-0 mt-1 text-[10px] text-muted">{formatDate(item.created_at)} · {transactionStatusLabel(item.status)}</p>
                  <p className="m-0 mt-1 text-[10px] text-muted">Phone: {item.payment_phone ?? profile?.phone ?? "—"} · {item.kind}</p>
                  {item.failure_reason && <p className="m-0 mt-1 text-[10px] text-danger">Failure: {item.failure_reason}</p>}
                  {item.kind === "withdraw" && item.net_amount != null && (
                    <p className="m-0 mt-1 text-[10px] text-muted">Fee UGX {formatMoney(item.fee ?? 0)} · Net UGX {formatMoney(item.net_amount)}</p>
                  )}
                </div>
                <span className={`shrink-0 text-[13px] font-bold ${item.kind === "withdraw" || item.kind === "invest" ? "text-ink" : "text-success"}`}>
                  {item.kind === "withdraw" || item.kind === "invest" ? "−" : item.status === "approved" ? "+" : ""}UGX {formatMoney(item.amount)}
                </span>
              </article>
            ))}
          </div>
        )}
        {!loading && hasMore && (
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="mt-4 h-10 w-full rounded-lg border border-primary/30 bg-white text-[12px] font-semibold text-primary disabled:opacity-60">
            {loadingMore ? "Loading..." : "Load more transactions"}
          </button>
        )}
      </Panel>
      <p className="m-0 text-[11px] text-muted">Each transaction records its type, phone number, amount, and current outcome.</p>
    </PageFrame>
  );
}

function transactionStatusLabel(status: Transaction["status"]) {
  if (status === "approved") return "Successful";
  if (status === "rejected") return "Failed";
  if (status === "processing") return "Processing";
  return "Pending";
}

function AdminTransactionsPage() {
  const { user } = useApp();
  const isAdmin = user?.app_metadata?.role === "admin";
  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    fetchAdminTransactions(getSupabaseBrowserClient(), 0, 100)
      .then((transactions) => {
        if (active) {
          setItems(transactions);
          setHasMore(transactions.length === 100);
        }
      })
      .catch(() => { if (active) setError("The transaction log could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAdmin]);

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      const transactions = await fetchAdminTransactions(getSupabaseBrowserClient(), items.length, 100);
      setItems((current) => [...current, ...transactions]);
      setHasMore(transactions.length === 100);
    } catch {
      setError("More transactions could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  if (!isAdmin) {
    return <PageFrame title="All transactions"><PageError message="Administrator access is required." /></PageFrame>;
  }

  return (
    <PageFrame title="All transactions">
      <Panel title="Transaction log">
        {error && <PageError message={error} />}
        {loading ? <EmptyMessage>Loading transactions...</EmptyMessage> : items.length === 0 ? <EmptyMessage>No transactions have been recorded.</EmptyMessage> : (
          <div className="divide-y divide-line-blue/50">
            {items.map((item) => (
              <article key={item.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 text-[13px] font-semibold capitalize text-ink">{item.kind}</p>
                    <p className="m-0 mt-1 text-[11px] text-ink-soft">Member: {item.member_phone ?? "—"} · Payment: {item.payment_phone ?? item.member_phone ?? "—"}</p>
                    <p className="m-0 mt-1 text-[10px] text-muted">{formatDate(item.created_at)}{item.payment_provider ? ` · ${item.payment_provider.toUpperCase()}` : ""}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="m-0 text-[12px] font-bold text-ink">UGX {formatMoney(item.amount)}</p>
                    <span className={`mt-1 inline-block rounded-full px-2 py-1 text-[10px] font-semibold ${
                      item.status === "approved" ? "bg-success/10 text-success"
                        : item.status === "rejected" ? "bg-danger/10 text-danger"
                          : item.status === "processing" ? "bg-wait/15 text-wait" : "bg-page text-muted"
                    }`}>{transactionStatusLabel(item.status)}</span>
                  </div>
                </div>
                {item.failure_reason && <p className="mb-0 mt-2 text-[11px] text-danger">Failure: {item.failure_reason}</p>}
                {item.kind === "withdraw" && item.net_amount != null && (
                  <p className="mb-0 mt-1 text-[10px] text-muted">Fee UGX {formatMoney(item.fee ?? 0)} · Paid UGX {formatMoney(item.net_amount)}</p>
                )}
              </article>
            ))}
          </div>
        )}
        {!loading && hasMore && (
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="mt-4 h-10 w-full rounded-lg border border-primary/30 bg-white text-[12px] font-semibold text-primary disabled:opacity-60">
            {loadingMore ? "Loading..." : "Load more transactions"}
          </button>
        )}
      </Panel>
    </PageFrame>
  );
}

function AboutPage() {
  return (
    <PageFrame title="About Testing Lives">
      <div className="relative aspect-[3/2] overflow-hidden rounded-xl bg-primary">
        <Image src="/images/about-us.jpg" alt="Testing Lives community awareness: HIV testing is voluntary, referral terms are disclosed, and results remain private." fill priority className="object-contain" sizes="448px" />
      </div>
      <Panel title="Our purpose">
        <p className="m-0 text-[13px] leading-relaxed text-ink-soft">Testing Lives makes HIV awareness and testing information accessible through community education, referrals, and awareness campaigns. Everyone deserves respectful, confidential, and non-discriminatory healthcare.</p>
      </Panel>
      <Panel title="Why HIV testing matters">
        <ul className="m-0 space-y-3 pl-5 text-[13px] leading-relaxed text-ink-soft">
          <li><strong className="text-ink">Know your status.</strong> Testing is the way to find out whether you have HIV.</li>
          <li><strong className="text-ink">Access treatment early.</strong> People diagnosed with HIV can access treatment that helps them live long, healthy lives.</li>
          <li><strong className="text-ink">Protect your loved ones.</strong> Knowing your status helps you make informed decisions about prevention and care.</li>
          <li><strong className="text-ink">Reduce stigma.</strong> Open, respectful conversations help create supportive communities.</li>
          <li><strong className="text-ink">Promote prevention.</strong> Testing services can connect people to effective HIV prevention options.</li>
        </ul>
      </Panel>
      <Panel title="Our referral and awareness program">
        <p className="m-0 text-[13px] leading-relaxed text-ink-soft">Talk about HIV testing, invite friends and relatives to learn more, and encourage people to visit qualified healthcare providers. Testing is always a personal, voluntary choice.</p>
      </Panel>
      <Panel title="Respect, privacy, and transparency">
        <ul className="m-0 space-y-3 pl-5 text-[13px] leading-relaxed text-ink-soft">
          <li>No one should be pressured, embarrassed, or forced to take an HIV test.</li>
          <li>If a referral reward or commission is offered through a separate program, its terms must be clearly disclosed.</li>
          <li>Medical results must never be shared with referrers without the person&apos;s explicit permission.</li>
          <li>For testing, advice, or care, contact a qualified healthcare provider.</li>
        </ul>
      </Panel>
    </PageFrame>
  );
}
