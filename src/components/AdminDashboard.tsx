"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type {
  AdminActiveTest,
  AdminDashboardData,
  AdminMember,
  AdminProduct,
  AdminSettings,
  AdminTransaction,
} from "@/lib/admin-types";
import {
  adjustMemberBalance,
  approveWithdrawal,
  fetchAdminDashboard,
  formatDate,
  formatMoney,
  manageWithdrawal,
  promoteAdmin,
  reviewAdminDeposit,
  saveAdminSettings,
  setWithdrawalMethod,
  updateAdminProduct,
  updateMemberBan,
} from "@/lib/app-data";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { CommunityLinks } from "@/lib/types";
import { useApp } from "./AppContext";

type DashboardTab = "overview" | "deposits" | "withdrawals" | "members" | "referrals" | "active-tests" | "test-plans" | "admins" | "settings";
type StatusFilter = "all" | "pending" | "approved" | "rejected";

const TABS: { id: DashboardTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "deposits", label: "Deposits" },
  { id: "withdrawals", label: "Withdrawals" },
  { id: "members", label: "Members" },
  { id: "referrals", label: "Referrals" },
  { id: "active-tests", label: "Active Tests" },
  { id: "test-plans", label: "Test Plans" },
  { id: "admins", label: "Admins" },
  { id: "settings", label: "Settings" },
];

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Waiting / pending" },
  { id: "approved", label: "Successful" },
  { id: "rejected", label: "Failed" },
];

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function currency(value: number) {
  return `UGX ${formatMoney(Number(value) || 0)}`;
}

function AdminPanel({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line-blue/60 bg-white p-4 shadow-[0_2px_10px_rgba(30,50,120,0.05)]">
      {(title || action) && <div className="mb-3 flex items-center justify-between gap-3">{title && <h2 className="m-0 text-[15px] font-bold text-ink">{title}</h2>}{action}</div>}
      {children}
    </section>
  );
}

function AdminInput({ label, className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-[12px] font-semibold text-ink-soft">
      {label}
      <input {...props} className={`mt-1.5 h-10 w-full rounded-lg border border-line-blue bg-white px-3 text-[13px] text-ink outline-none focus:border-primary ${className}`} />
    </label>
  );
}

function AdminTextarea({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="block text-[12px] font-semibold text-ink-soft">
      {label}
      <textarea {...props} className="mt-1.5 min-h-20 w-full rounded-lg border border-line-blue bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-primary" />
    </label>
  );
}

function ActionButton({ children, onClick, disabled = false, secondary = false }: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex min-h-9 items-center justify-center rounded-lg px-3 py-2 text-[11px] font-bold disabled:opacity-50 ${secondary ? "border border-line-blue bg-white text-ink-soft" : "bg-primary text-white"}`}>
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: AdminTransaction["status"] }) {
  const style = status === "approved" ? "bg-success/10 text-success"
    : status === "rejected" ? "bg-danger/10 text-danger"
      : status === "processing" ? "bg-wait/15 text-wait" : "bg-page text-muted";
  const label = status === "approved" ? "Successful"
    : status === "rejected" ? "Failed"
      : status === "processing" ? "Processing" : "Pending";
  return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${style}`}>{label}</span>;
}

function SmallStat({ label, value, note, onClick }: { label: string; value: string; note?: string; onClick?: () => void }) {
  const content = (
    <>
      <span className="block text-[11px] font-medium text-muted">{label}</span>
      <strong className="mt-1 block break-words text-[18px] font-extrabold leading-tight text-ink">{value}</strong>
      {note && <span className="mt-1 block text-[10px] leading-relaxed text-muted">{note}</span>}
    </>
  );
  if (onClick) return <button type="button" onClick={onClick} className="min-h-[92px] rounded-xl border border-line-blue/60 bg-white p-3 text-left shadow-[0_2px_10px_rgba(30,50,120,0.05)]">{content}</button>;
  return <div className="min-h-[92px] rounded-xl border border-line-blue/60 bg-white p-3 shadow-[0_2px_10px_rgba(30,50,120,0.05)]">{content}</div>;
}

export function AdminDashboard() {
  const { user, navigate, toast } = useApp();
  const isAdmin = user?.app_metadata?.role === "admin";
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [balanceDirection, setBalanceDirection] = useState<"credit" | "debit">("credit");
  const [balanceAmount, setBalanceAmount] = useState("");
  const [balanceReason, setBalanceReason] = useState("");
  const [banReason, setBanReason] = useState("");
  const [reasonByTransaction, setReasonByTransaction] = useState<Record<string, string>>({});
  const [referenceByTransaction, setReferenceByTransaction] = useState<Record<string, string>>({});
  const [promotePhone, setPromotePhone] = useState("");
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [links, setLinks] = useState<CommunityLinks>({ serviceChatUrl: "", telegramGroupUrl: "" });
  const [savingPlan, setSavingPlan] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [promoting, setPromoting] = useState(false);

  const loadDashboard = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminDashboard(getSupabaseBrowserClient());
      setDashboard(data);
      setSettings(data.settings);
      setLinks({
        serviceChatUrl: data.community.service_chat_url,
        telegramGroupUrl: data.community.telegram_group_url,
      });
    } catch (loadError) {
      setError(messageOf(loadError, "Admin dashboard could not be loaded. Apply the admin dashboard migration and try again."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    fetchAdminDashboard(getSupabaseBrowserClient())
      .then((data) => {
        if (!active) return;
        setDashboard(data);
        setSettings(data.settings);
        setLinks({
          serviceChatUrl: data.community.service_chat_url,
          telegramGroupUrl: data.community.telegram_group_url,
        });
      })
      .catch((loadError: unknown) => {
        if (active) setError(messageOf(loadError, "Admin dashboard could not be loaded. Apply the admin dashboard migration and try again."));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAdmin]);

  async function runAction(id: string, action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await loadDashboard();
      toast(success);
      return true;
    } catch (actionError) {
      const message = messageOf(actionError, "The requested action could not be completed.");
      setError(message);
      toast(message, "error");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function updatePlan(id: string, update: Partial<AdminProduct>) {
    setDashboard((current) => current && ({
      ...current,
      products: current.products.map((product) => product.id === id ? { ...product, ...update } : product),
    }));
  }

  async function savePlan(product: AdminProduct) {
    setSavingPlan(product.id);
    setError(null);
    try {
      await updateAdminProduct(getSupabaseBrowserClient(), product);
      await loadDashboard();
      toast(`${product.name} saved.`);
    } catch (saveError) {
      setError(messageOf(saveError, "The plan could not be saved."));
    } finally {
      setSavingPlan(null);
    }
  }

  async function submitBalanceAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMember || !dashboard) return;
    const member = dashboard.members.find(({ id }) => id === selectedMember);
    if (!member) return;
    const amount = Number(balanceAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !balanceReason.trim()) {
      setError("Enter a positive amount and explain the adjustment.");
      return;
    }
    const succeeded = await runAction(
      member.id,
      () => adjustMemberBalance(getSupabaseBrowserClient(), member.id, balanceDirection, amount, balanceReason.trim()),
      `${balanceDirection === "credit" ? "Credit" : "Debit"} recorded for ${member.phone}.`,
    );
    if (!succeeded) return;
    setBalanceAmount("");
    setBalanceReason("");
    setSelectedMember(null);
  }

  async function toggleBan(member: AdminMember) {
    if (!member.is_banned && banReason.trim().length < 3) {
      setError("Enter a ban reason of at least 3 characters.");
      return;
    }
    const succeeded = await runAction(
      member.id,
      () => updateMemberBan(member.id, !member.is_banned, member.is_banned ? "" : banReason.trim()),
      member.is_banned ? `${member.phone} restored.` : `${member.phone} banned.`,
    );
    if (!succeeded) return;
    setBanReason("");
  }

  async function submitPromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!promotePhone.trim()) return;
    setPromoting(true);
    setError(null);
    try {
      await promoteAdmin(promotePhone);
      setPromotePhone("");
      await loadDashboard();
      toast("Administrator role granted. The member may need to sign in again.");
    } catch (promotionError) {
      setError(messageOf(promotionError, "The member could not be promoted."));
    } finally {
      setPromoting(false);
    }
  }

  async function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setSavingSettings(true);
    setError(null);
    try {
      await saveAdminSettings(getSupabaseBrowserClient(), settings, links);
      await loadDashboard();
      toast("Application settings saved.");
    } catch (saveError) {
      setError(messageOf(saveError, "Application settings could not be saved."));
    } finally {
      setSavingSettings(false);
    }
  }

  const members = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    return dashboard?.members.filter((member) =>
      !query || member.phone.toLowerCase().includes(query) || member.referral_code.toLowerCase().includes(query),
    ) ?? [];
  }, [dashboard?.members, memberSearch]);

  const transactions = useMemo(() => {
    const kind = tab === "deposits" ? "deposit" : "withdraw";
    return (dashboard?.transactions ?? [])
      .filter((transaction) => transaction.kind === kind)
      .filter((transaction) => statusFilter === "all"
        || (statusFilter === "pending" ? transaction.status === "pending" || transaction.status === "processing" : transaction.status === statusFilter));
  }, [dashboard?.transactions, statusFilter, tab]);

  async function actionWithdrawal(transaction: AdminTransaction, action: "reject" | "approve_manual" | "manual_paid" | "manual_failed") {
    const reason = reasonByTransaction[transaction.id] ?? "";
    const reference = referenceByTransaction[transaction.id] ?? "";
    const succeeded = await runAction(
      transaction.id,
      () => manageWithdrawal(getSupabaseBrowserClient(), transaction.id, action, reason, reference),
      action === "reject" ? "Withdrawal rejected and reserved funds refunded."
        : action === "approve_manual" ? "Manual payout approved."
          : action === "manual_paid" ? "Manual payout marked successful."
            : "Manual payout marked failed and funds refunded.",
    );
    if (!succeeded) return;
    setReasonByTransaction((values) => ({ ...values, [transaction.id]: "" }));
    setReferenceByTransaction((values) => ({ ...values, [transaction.id]: "" }));
  }

  async function changePayoutMethod(transaction: AdminTransaction, method: "manual" | "api") {
    if (transaction.payout_method === method) return;
    await runAction(
      transaction.id,
      () => setWithdrawalMethod(getSupabaseBrowserClient(), transaction.id, method),
      `Payout method changed to ${method.toUpperCase()}.`,
    );
  }

  async function approveApiWithdrawal(transaction: AdminTransaction) {
    await runAction(
      transaction.id,
      () => approveWithdrawal(transaction.id),
      "API payout request sent. Check transaction status before retrying.",
    );
  }

  if (!isAdmin) {
    return <main className="min-h-screen bg-page p-4"><AdminPanel><p role="alert" className="m-0 text-[13px] text-danger">Administrator access is required.</p></AdminPanel></main>;
  }

  return (
    <main className="min-h-screen bg-page pb-10">
      <header className="flex items-center justify-between gap-3 border-b border-line-blue/60 bg-white px-4 pb-4 pt-5">
        <div>
          <p className="m-0 text-[11px] font-semibold uppercase text-primary">Testing Lives</p>
          <h1 className="m-0 mt-0.5 text-[20px] font-bold text-ink">Admin dashboard</h1>
        </div>
        <div className="flex gap-2">
          <ActionButton secondary onClick={() => void loadDashboard(true)}>Refresh</ActionButton>
          <ActionButton secondary onClick={() => navigate("/account")}>My account</ActionButton>
        </div>
      </header>

      <nav aria-label="Admin dashboard sections" className="sticky top-0 z-10 overflow-x-auto border-b border-line-blue/70 bg-white px-2 py-2">
        <div role="tablist" className="flex min-w-max gap-1">
          {TABS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => { setTab(item.id); setStatusFilter("all"); setError(null); }} className={`min-h-10 rounded-lg px-3 text-[12px] font-bold ${tab === item.id ? "bg-primary text-white" : "text-ink-soft hover:bg-page"}`}>
              {item.label}
              {item.id === "deposits" && dashboard?.overview.deposits_pending ? <span className="ml-1 rounded-full bg-white/20 px-1.5">{dashboard.overview.deposits_pending}</span> : null}
              {item.id === "withdrawals" && dashboard?.overview.withdrawals_pending ? <span className="ml-1 rounded-full bg-white/20 px-1.5">{dashboard.overview.withdrawals_pending}</span> : null}
            </button>
          ))}
        </div>
      </nav>

      <div className="space-y-4 px-4 py-4">
        {error && <p role="alert" className="m-0 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        {loading ? (
          <AdminPanel><p className="m-0 py-4 text-center text-[13px] text-muted">Loading admin dashboard…</p></AdminPanel>
        ) : !dashboard ? (
          <AdminPanel><p className="m-0 text-[13px] text-ink-soft">Dashboard data is unavailable. Check the database migration and refresh.</p></AdminPanel>
        ) : (
          <>
            {tab === "overview" && <OverviewPanel data={dashboard} goTo={setTab} />}
            {(tab === "deposits" || tab === "withdrawals") && (
              <AdminPanel title={`${tab === "deposits" ? "Deposits" : "Withdrawals"} · ${transactions.length}`}>
                <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
                  {STATUS_FILTERS.map((filter) => <button key={filter.id} type="button" aria-pressed={statusFilter === filter.id} onClick={() => setStatusFilter(filter.id)} className={`shrink-0 rounded-lg px-3 py-2 text-[11px] font-semibold ${statusFilter === filter.id ? "bg-primary text-white" : "bg-page text-ink-soft"}`}>{filter.label}</button>)}
                </div>
                {transactions.length === 0 ? <p className="m-0 rounded-lg bg-page p-4 text-center text-[12px] text-muted">No matching {tab}.</p> : (
                  <div className="space-y-3">{transactions.map((transaction) => (
                    <TransactionCard
                      key={transaction.id}
                      transaction={transaction}
                      busy={busyId === transaction.id}
                      reason={reasonByTransaction[transaction.id] ?? ""}
                      reference={referenceByTransaction[transaction.id] ?? ""}
                      onReason={(value) => setReasonByTransaction((values) => ({ ...values, [transaction.id]: value }))}
                      onReference={(value) => setReferenceByTransaction((values) => ({ ...values, [transaction.id]: value }))}
                      onDepositReview={(action) => void runAction(
                        transaction.id,
                        () => reviewAdminDeposit(getSupabaseBrowserClient(), transaction.id, action, reasonByTransaction[transaction.id] ?? ""),
                        action === "approve" ? "Deposit approved and wallet credited." : "Deposit rejected.",
                      )}
                      onWithdrawalAction={(action) => void actionWithdrawal(transaction, action)}
                      onPayoutMethod={(method) => void changePayoutMethod(transaction, method)}
                      onApproveApi={() => void approveApiWithdrawal(transaction)}
                    />
                  ))}</div>
                )}
              </AdminPanel>
            )}
            {tab === "members" && (
              <AdminPanel title={`Members · ${dashboard.members.length}`}>
                <AdminInput label="Search phone or referral code" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="07… or code" />
                <div className="mt-3 space-y-3">
                  {members.map((member) => (
                    <MemberCard
                      key={member.id}
                      member={member}
                      selected={selectedMember === member.id}
                      busy={busyId === member.id}
                      direction={balanceDirection}
                      amount={balanceAmount}
                      reason={balanceReason}
                      banReason={banReason}
                      onSelect={() => { setSelectedMember(selectedMember === member.id ? null : member.id); setError(null); }}
                      onDirection={setBalanceDirection}
                      onAmount={setBalanceAmount}
                      onReason={setBalanceReason}
                      onBanReason={setBanReason}
                      onAdjust={(event) => void submitBalanceAdjustment(event)}
                      onBan={() => void toggleBan(member)}
                    />
                  ))}
                  {members.length === 0 && <p className="m-0 rounded-lg bg-page p-4 text-center text-[12px] text-muted">No members match that search.</p>}
                </div>
              </AdminPanel>
            )}
            {tab === "referrals" && <ReferralsPanel data={dashboard} />}
            {tab === "active-tests" && <ActiveTestsPanel tests={dashboard.active_tests} />}
            {tab === "test-plans" && (
              <AdminPanel title={`Test plans · ${dashboard.products.length}`}>
                <p className="mb-3 mt-0 text-[11px] leading-relaxed text-muted">Turning a plan off archives it from member purchase screens; previous purchases and records remain unchanged.</p>
                <div className="space-y-3">
                  {dashboard.products.map((product) => (
                    <form key={product.id} className="space-y-3 rounded-lg border border-line-blue/60 p-3" onSubmit={(event) => { event.preventDefault(); void savePlan(product); }}>
                      <AdminInput label="Plan name" value={product.name} onChange={(event) => updatePlan(product.id, { name: event.target.value })} required />
                      <div className="grid grid-cols-2 gap-3">
                        <AdminInput label="Price (UGX)" type="number" min="1" step="1" value={product.price} onChange={(event) => updatePlan(product.id, { price: Number(event.target.value) })} required />
                        <AdminInput label="Daily return (UGX)" type="number" min="1" step="1" value={product.daily_income} onChange={(event) => updatePlan(product.id, { daily_income: Number(event.target.value) })} required />
                        <AdminInput label="Duration (days)" type="number" min="1" max="3650" step="1" value={product.duration_days} onChange={(event) => updatePlan(product.id, { duration_days: Number(event.target.value) })} required />
                        <label className="flex items-end gap-2 pb-2 text-[12px] font-semibold text-ink-soft"><input type="checkbox" checked={product.active} onChange={(event) => updatePlan(product.id, { active: event.target.checked })} /> Available for purchase</label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton onClick={() => void savePlan(product)} disabled={savingPlan === product.id}>{savingPlan === product.id ? "Saving…" : "Save changes"}</ActionButton>
                        <ActionButton secondary onClick={() => void savePlan({ ...product, active: !product.active })} disabled={savingPlan === product.id}>{product.active ? "Archive plan" : "Restore plan"}</ActionButton>
                      </div>
                    </form>
                  ))}
                  {dashboard.products.length === 0 && <p className="m-0 text-[12px] text-muted">No test plans were found.</p>}
                </div>
              </AdminPanel>
            )}
            {tab === "admins" && (
              <>
                <AdminPanel title="Promote member">
                  <form id="promote-admin-form" onSubmit={(event) => void submitPromotion(event)} className="space-y-3">
                    <AdminInput label="Member phone number" type="tel" autoComplete="tel" value={promotePhone} onChange={(event) => setPromotePhone(event.target.value)} placeholder="+256 7XX XXX XXX" required />
                    <button type="submit" disabled={promoting} className="min-h-9 rounded-lg bg-primary px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50">{promoting ? "Promoting…" : "Promote to admin"}</button>
                  </form>
                </AdminPanel>
                <AdminPanel title={`Administrators · ${dashboard.admins.length}`}>
                  <div className="divide-y divide-line-blue/50">
                    {dashboard.admins.map((admin) => <div key={admin.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><div><p className="m-0 text-[13px] font-semibold text-ink">{admin.phone}</p><p className="m-0 mt-1 text-[10px] text-muted">{admin.email || "No email"} · joined {formatDate(admin.created_at)}</p></div><span className="rounded-full bg-success/10 px-2 py-1 text-[10px] font-bold text-success">Admin</span></div>)}
                  </div>
                </AdminPanel>
              </>
            )}
            {tab === "settings" && settings && (
              <AdminPanel title="Application settings">
                <form onSubmit={(event) => void submitSettings(event)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <AdminInput label="Minimum deposit (UGX)" type="number" min="0" step="1" value={settings.minimum_deposit} onChange={(event) => setSettings({ ...settings, minimum_deposit: Number(event.target.value) })} required />
                    <AdminInput label="Minimum withdrawal (UGX)" type="number" min="0" step="1" value={settings.minimum_withdrawal} onChange={(event) => setSettings({ ...settings, minimum_withdrawal: Number(event.target.value) })} required />
                    <AdminInput label="Withdrawal start (Kampala)" type="time" value={settings.withdrawal_start} onChange={(event) => setSettings({ ...settings, withdrawal_start: event.target.value })} required />
                    <AdminInput label="Withdrawal end (Kampala)" type="time" value={settings.withdrawal_end} onChange={(event) => setSettings({ ...settings, withdrawal_end: event.target.value })} required />
                    <AdminInput label="Withdrawal fee (%)" type="number" min="0" max="100" step="0.01" value={settings.withdrawal_fee_percent} onChange={(event) => setSettings({ ...settings, withdrawal_fee_percent: Number(event.target.value) })} required />
                    <AdminInput label="Referral reward (%)" type="number" min="0" max="100" step="0.01" value={settings.referral_reward_percent} onChange={(event) => setSettings({ ...settings, referral_reward_percent: Number(event.target.value) })} required />
                  </div>
                  <AdminTextarea label="Referral rules" maxLength={1000} value={settings.referral_rule} onChange={(event) => setSettings({ ...settings, referral_rule: event.target.value })} />
                  <AdminTextarea label="Welcome message" maxLength={2000} value={settings.welcome_message} onChange={(event) => setSettings({ ...settings, welcome_message: event.target.value })} />
                  <AdminInput label="Service Telegram link" type="url" value={links.serviceChatUrl} onChange={(event) => setLinks({ ...links, serviceChatUrl: event.target.value })} placeholder="https://t.me/support" />
                  <AdminInput label="Telegram group link" type="url" value={links.telegramGroupUrl} onChange={(event) => setLinks({ ...links, telegramGroupUrl: event.target.value })} placeholder="https://t.me/group" />
                  <p className="m-0 text-[10px] leading-relaxed text-muted">Links must be HTTPS Telegram destinations. Withdrawal window uses Kampala time and supports overnight hours.</p>
                  <button type="submit" disabled={savingSettings} className="min-h-10 rounded-lg bg-primary px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50">{savingSettings ? "Saving…" : "Save settings"}</button>
                </form>
              </AdminPanel>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function OverviewPanel({ data, goTo }: { data: AdminDashboardData; goTo: (tab: DashboardTab) => void }) {
  const overview = data.overview;
  const metrics: [string, number, boolean?][] = [
    ["Total members", overview.total_members],
    ["Joined today", overview.joined_today],
    ["Joined yesterday", overview.joined_yesterday],
    ["Deposited", overview.deposited, true],
    ["Withdrawn", overview.withdrawn, true],
    ["Invested in plans", overview.invested, true],
    ["Returns paid out", overview.returns_paid, true],
    ["Test plan purchases", overview.test_plan_volume],
    ["Referral commission paid", overview.referral_commission_paid, true],
    ["Member wallet balances", overview.member_wallet_balance, true],
    ["Active test plans", overview.active_test_plans],
    ["Referral link copies", overview.referral_links_sent],
    ["Net revenue collected (estimate)", overview.net_revenue_collected, true],
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {metrics.map(([label, value, money]) => <SmallStat key={label} label={label} value={money ? currency(value) : Number(value).toLocaleString()} note={label === "Net revenue collected (estimate)" ? "Approved deposits minus approved net withdrawals, member returns, and referral commissions. Operational estimate, not audited accounts." : undefined} />)}
        <SmallStat label="Deposits needing attention" value={overview.deposits_pending.toLocaleString()} onClick={() => goTo("deposits")} />
        <SmallStat label="Withdrawals needing attention" value={overview.withdrawals_pending.toLocaleString()} onClick={() => goTo("withdrawals")} />
      </div>
      <AdminPanel title="Attention queue">
        <div className="grid grid-cols-2 gap-2">
          <ActionButton onClick={() => goTo("deposits")}>Review deposits ({overview.deposits_pending})</ActionButton>
          <ActionButton secondary onClick={() => goTo("withdrawals")}>Review withdrawals ({overview.withdrawals_pending})</ActionButton>
        </div>
      </AdminPanel>
    </>
  );
}

function TransactionCard({
  transaction,
  busy,
  reason,
  reference,
  onReason,
  onReference,
  onDepositReview,
  onWithdrawalAction,
  onPayoutMethod,
  onApproveApi,
}: {
  transaction: AdminTransaction;
  busy: boolean;
  reason: string;
  reference: string;
  onReason: (value: string) => void;
  onReference: (value: string) => void;
  onDepositReview: (action: "approve" | "reject") => void;
  onWithdrawalAction: (action: "reject" | "approve_manual" | "manual_paid" | "manual_failed") => void;
  onPayoutMethod: (method: "manual" | "api") => void;
  onApproveApi: () => void;
}) {
  const providerDeposit = transaction.kind === "deposit" && Boolean(transaction.provider_transaction_id || transaction.payment_provider);
  const waiting = transaction.status === "pending";
  const processing = transaction.status === "processing";
  return (
    <article className="rounded-lg border border-line-blue/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-bold text-ink">{transaction.member_phone}</p>
          <p className="m-0 mt-1 break-all text-[10px] text-muted">{formatDate(transaction.created_at)} · Ref: {transaction.payment_reference || transaction.id}</p>
        </div>
        <StatusBadge status={transaction.status} />
      </div>
      <dl className="mb-0 mt-3 space-y-1.5 text-[11px]">
        <InfoRow label="Payment number" value={transaction.payment_phone || transaction.member_phone} />
        <InfoRow label="Amount" value={currency(transaction.kind === "withdraw" ? transaction.net_amount ?? transaction.amount : transaction.amount)} />
        {transaction.kind === "withdraw" && <InfoRow label="Gross / fee" value={`${currency(transaction.amount)} / ${currency(transaction.fee)}`} />}
        <InfoRow label="Network" value={transaction.payment_provider?.toUpperCase() ?? "Not specified"} />
        <InfoRow label="Reviewed by" value={transaction.approved_by_phone || "—"} />
        <InfoRow label="Payout method" value={transaction.payout_method.toUpperCase()} />
        {transaction.provider_transaction_id && <InfoRow label="Provider transaction" value={transaction.provider_transaction_id} />}
        {transaction.manual_payment_reference && <InfoRow label="Manual payment ref" value={transaction.manual_payment_reference} />}
      </dl>
      {(transaction.failure_reason || transaction.admin_reason) && <p className="mb-0 mt-2 text-[11px] text-danger">Reason: {transaction.admin_reason || transaction.failure_reason}</p>}
      {transaction.kind === "deposit" && !providerDeposit && (waiting || processing) && (
        <div className="mt-3 space-y-2 border-t border-line-blue/50 pt-3">
          <AdminInput label="Review reason (required for rejection)" value={reason} onChange={(event) => onReason(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            {waiting && <ActionButton onClick={() => onDepositReview("approve")} disabled={busy}>Approve deposit</ActionButton>}
            <ActionButton secondary onClick={() => onDepositReview("reject")} disabled={busy || reason.trim().length < 3}>Reject deposit</ActionButton>
          </div>
        </div>
      )}
      {providerDeposit && (waiting || processing) && <p className="mb-0 mt-3 rounded-lg bg-page p-2 text-[10px] leading-relaxed text-muted">This deposit is settled only by verified payment-provider confirmation; manual credit/rejection is disabled.</p>}
      {transaction.kind === "withdraw" && (waiting || processing) && (
        <div className="mt-3 space-y-3 border-t border-line-blue/50 pt-3">
          {waiting && (
            <div className="flex flex-wrap gap-2">
              <ActionButton secondary onClick={() => onPayoutMethod("manual")} disabled={busy || transaction.payout_method === "manual"}>Manual payout</ActionButton>
              <ActionButton secondary onClick={() => onPayoutMethod("api")} disabled={busy || transaction.payout_method === "api"}>API payout</ActionButton>
            </div>
          )}
          {(transaction.payout_method === "manual" && waiting) && (
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={() => onWithdrawalAction("approve_manual")} disabled={busy}>Approve manual payout</ActionButton>
              <AdminInput label="Rejection reason (required)" value={reason} onChange={(event) => onReason(event.target.value)} />
              <ActionButton secondary onClick={() => onWithdrawalAction("reject")} disabled={busy || reason.trim().length < 3}>Reject & refund</ActionButton>
            </div>
          )}
          {(transaction.payout_method === "api" && waiting) && (
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={onApproveApi} disabled={busy}>Approve & send API payout</ActionButton>
              <AdminInput label="Rejection reason (required)" value={reason} onChange={(event) => onReason(event.target.value)} />
              <ActionButton secondary onClick={() => onWithdrawalAction("reject")} disabled={busy || reason.trim().length < 3}>Reject & refund</ActionButton>
            </div>
          )}
          {processing && transaction.payout_method === "api" && <ActionButton onClick={onApproveApi} disabled={busy}>Retry API payout</ActionButton>}
          {processing && transaction.payout_method === "manual" && (
            <>
              <AdminInput label="External payment reference (required)" value={reference} onChange={(event) => onReference(event.target.value)} maxLength={200} required />
              <ActionButton onClick={() => onWithdrawalAction("manual_paid")} disabled={busy || !reference.trim()}>Mark as paid</ActionButton>
              <AdminInput label="Failure reason (required)" value={reason} onChange={(event) => onReason(event.target.value)} />
              <ActionButton secondary onClick={() => onWithdrawalAction("manual_failed")} disabled={busy || reason.trim().length < 3}>Mark failed & refund</ActionButton>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return <div className="grid grid-cols-[38%_1fr] gap-2"><dt className="text-muted">{label}</dt><dd className="m-0 break-words text-right font-semibold text-ink">{value}</dd></div>;
}

function MemberCard({
  member,
  selected,
  busy,
  direction,
  amount,
  reason,
  banReason,
  onSelect,
  onDirection,
  onAmount,
  onReason,
  onBanReason,
  onAdjust,
  onBan,
}: {
  member: AdminMember;
  selected: boolean;
  busy: boolean;
  direction: "credit" | "debit";
  amount: string;
  reason: string;
  banReason: string;
  onSelect: () => void;
  onDirection: (value: "credit" | "debit") => void;
  onAmount: (value: string) => void;
  onReason: (value: string) => void;
  onBanReason: (value: string) => void;
  onAdjust: (event: FormEvent<HTMLFormElement>) => void;
  onBan: () => void;
}) {
  return (
    <article className="rounded-lg border border-line-blue/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-bold text-ink">{member.phone} {member.is_admin ? <span className="text-[10px] text-primary">· Admin</span> : null}</p>
          <p className="m-0 mt-1 text-[10px] text-muted">Joined {formatDate(member.created_at)} · Code {member.referral_code}</p>
          <p className="m-0 mt-1 text-[12px] font-semibold text-primary">Wallet {currency(member.balance)} {member.is_banned ? <span className="text-danger">· Banned</span> : ""}</p>
        </div>
        <button type="button" onClick={onSelect} className="rounded-lg border border-line-blue px-2 py-1.5 text-[10px] font-bold text-primary">{selected ? "Close" : "Manage"}</button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-muted">
        <span>Deposited {currency(member.deposited)}</span><span>Withdrawn {currency(member.withdrawn)}</span>
        <span>Invested {currency(member.invested)}</span><span>Credited / debited {currency(member.credited)} / {currency(member.deducted)}</span>
      </div>
      {selected && (
        <div className="mt-3 space-y-3 border-t border-line-blue/50 pt-3">
          {!member.is_banned && (
            <form onSubmit={onAdjust} className="space-y-3">
              <div className="flex gap-2">
                <button type="button" aria-pressed={direction === "credit"} onClick={() => onDirection("credit")} className={`rounded-lg px-3 py-2 text-[11px] font-bold ${direction === "credit" ? "bg-primary text-white" : "bg-page text-ink-soft"}`}>Credit</button>
                <button type="button" aria-pressed={direction === "debit"} onClick={() => onDirection("debit")} className={`rounded-lg px-3 py-2 text-[11px] font-bold ${direction === "debit" ? "bg-primary text-white" : "bg-page text-ink-soft"}`}>Debit</button>
              </div>
              <AdminInput label="Amount (UGX)" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => onAmount(event.target.value)} required />
              <AdminInput label="Reason" minLength={3} maxLength={500} value={reason} onChange={(event) => onReason(event.target.value)} required />
              <button type="submit" disabled={busy} className="min-h-9 rounded-lg bg-primary px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50">{busy ? "Saving…" : `Apply ${direction}`}</button>
            </form>
          )}
          {!member.is_banned && <AdminInput label="Ban reason (required)" minLength={3} maxLength={500} value={banReason} onChange={(event) => onBanReason(event.target.value)} />}
          <button type="button" onClick={onBan} disabled={busy || (!member.is_banned && banReason.trim().length < 3)} className={`min-h-9 rounded-lg border px-3 py-2 text-[11px] font-bold disabled:opacity-50 ${member.is_banned ? "border-success/40 text-success" : "border-danger/40 text-danger"}`}>{member.is_banned ? "Restore member" : "Ban member"}</button>
        </div>
      )}
    </article>
  );
}

function ReferralsPanel({ data }: { data: AdminDashboardData }) {
  return (
    <AdminPanel title={`Referrals · ${data.referrals.length}`}>
      <p className="mb-3 mt-0 text-[12px] text-ink-soft">Invitation link copied {data.overview.referral_links_sent.toLocaleString()} times · Commission paid {currency(data.overview.referral_commission_paid)}.</p>
      <div className="space-y-3">
        {data.referrals.map((referral) => (
          <article key={referral.id} className="rounded-lg border border-line-blue/60 p-3">
            <p className="m-0 text-[13px] font-bold text-ink">{referral.phone} <span className="font-normal text-muted">({referral.referral_code})</span></p>
            <p className="m-0 mt-1 text-[11px] text-muted">Invited by {referral.referrer_phone} · code {referral.referrer_code} · {formatDate(referral.created_at)}</p>
            <div className="mt-2 flex justify-between gap-3 text-[11px]"><span className="text-muted">Invested {currency(referral.invested)}</span><span className="font-semibold text-primary">Commission {currency(referral.commission_paid)}</span></div>
          </article>
        ))}
        {data.referrals.length === 0 && <p className="m-0 rounded-lg bg-page p-4 text-center text-[12px] text-muted">No referred members have joined yet.</p>}
      </div>
    </AdminPanel>
  );
}

function ActiveTestsPanel({ tests }: { tests: AdminActiveTest[] }) {
  return (
    <AdminPanel title={`Active test plans · ${tests.length}`}>
      <div className="space-y-3">
        {tests.map((test) => (
          <article key={test.id} className="rounded-lg border border-line-blue/60 p-3">
            <div className="flex items-start justify-between gap-3"><div><p className="m-0 text-[13px] font-bold text-ink">{test.phone} · {test.plan_name}</p><p className="m-0 mt-1 text-[10px] text-muted">Started {formatDate(test.started_at)} · Payout date {formatDate(test.ends_at)}</p></div><span className="rounded-full bg-success/10 px-2 py-1 text-[10px] font-bold text-success">{test.test_status}</span></div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]"><span className="text-muted">Amount {currency(test.amount)}</span><span className="text-muted">Daily return {currency(test.daily_income)}</span><span className="text-muted">Progress {Math.min(test.elapsed_days, test.duration_days)}/{test.duration_days} days</span><span className="font-semibold text-primary">Days rewarded {test.claimed_days}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-page"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, test.duration_days ? (test.elapsed_days / test.duration_days) * 100 : 0)}%` }} /></div>
          </article>
        ))}
        {tests.length === 0 && <p className="m-0 rounded-lg bg-page p-4 text-center text-[12px] text-muted">There are no active test plans.</p>}
      </div>
    </AdminPanel>
  );
}
