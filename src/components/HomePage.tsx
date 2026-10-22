"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  claimDailyIncome,
  daysElapsed,
  fetchCommunityLinks,
  fetchInvestments,
  fetchProducts,
  fetchPublicAppSettings,
  formatMoney,
} from "@/lib/app-data";
import type { AdminSettings } from "@/lib/admin-types";
import type { CommunityLinks, Investment, Product } from "@/lib/types";
import { useApp } from "./AppContext";
import {
  IconDeposit,
  IconHeadset,
  IconTelegram,
  IconWithdraw,
} from "./Icons";
import { InvestSheet } from "./InvestSheet";

const CAROUSEL_IMAGES = [
  { src: "/images/plan1.jpg", alt: "HIV testing awareness" },
  { src: "/images/plan3.jpg", alt: "World AIDS Day awareness" },
  { src: "/images/plan4.jpg", alt: "Know your status and protect your health" },
];

const EMPTY_LINKS: CommunityLinks = {
  serviceChatUrl: "",
  telegramGroupUrl: "",
};

const DEFAULT_SETTINGS: AdminSettings = {
  minimum_deposit: 10000,
  minimum_withdrawal: 5000,
  withdrawal_start: "09:00",
  withdrawal_end: "21:00",
  withdrawal_fee_percent: 20,
  referral_reward_percent: 15,
  referral_rule: "",
  welcome_message: "Official support will never ask for your password or screenshots of your deposits. Keep your account details private.",
};

type HomeTab = "earnings" | "plans";

export function HomePage() {
  const { profile, navigate, toast, refreshProfile } = useApp();
  const [products, setProducts] = useState<Product[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [communityLinks, setCommunityLinks] = useState(EMPTY_LINKS);
  const [appSettings, setAppSettings] = useState(DEFAULT_SETTINGS);
  const [purchaseCounts, setPurchaseCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Product | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [activeTab, setActiveTab] = useState<HomeTab>("plans");
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % CAROUSEL_IMAGES.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const userId = profile?.id;
    const client = getSupabaseBrowserClient();

    void Promise.all([
      fetchProducts(client),
      userId ? fetchInvestments(client, userId) : Promise.resolve([]),
    ])
      .then(([list, userInvestments]) => {
        if (!active) return;
        setProducts(list);
        setInvestments(userInvestments);
        setPurchaseCounts(userInvestments.reduce<Record<string, number>>((counts, investment) => {
          counts[investment.product_id] = (counts[investment.product_id] ?? 0) + 1;
          return counts;
        }, {}));
      })
      .catch(() => {
        if (active) toast("Could not load test plans.", "error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    void fetchCommunityLinks(client)
      .then((links) => { if (active) setCommunityLinks(links); })
      .catch(() => {
        if (active) toast("Community contact links could not be loaded.", "error");
      });

    void fetchPublicAppSettings(client)
      .then((settings) => { if (active) setAppSettings(settings); })
      .catch(() => {
        if (active) toast("Welcome and payment settings could not be loaded.", "error");
      });

    return () => { active = false; };
  }, [profile?.id, toast]);

  async function claimEarnings(investment: Investment) {
    setClaiming(investment.id);
    try {
      const amount = await claimDailyIncome(getSupabaseBrowserClient(), investment.id);
      await refreshProfile();
      const updated = await fetchInvestments(getSupabaseBrowserClient(), investment.user_id);
      setInvestments(updated);
      toast(`UGX ${formatMoney(amount)} added to your balance.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Daily earnings could not be claimed.", "error");
    } finally {
      setClaiming(null);
    }
  }

  return (
    <main className="min-h-screen pb-[92px]">
      <section aria-label="HIV awareness carousel" className="relative mx-[15px] mt-[14px] aspect-[1.95/1] overflow-hidden rounded-2xl bg-white shadow-[0_3px_12px_rgba(30,50,120,0.12)]">
        {CAROUSEL_IMAGES.map((slide, index) => (
          <Image
            key={slide.src}
            src={slide.src}
            alt={slide.alt}
            fill
            priority={index === 0}
            sizes="450px"
            className={`object-cover transition-opacity duration-700 ${activeSlide === index ? "opacity-100" : "opacity-0"}`}
          />
        ))}
        <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 bg-gradient-to-t from-black/35 to-transparent pb-3 pt-8">
          {CAROUSEL_IMAGES.map((slide, index) => (
            <button
              key={slide.src}
              type="button"
              onClick={() => setActiveSlide(index)}
              aria-label={`Show awareness slide ${index + 1}`}
              aria-current={activeSlide === index}
              className={`h-2 rounded-full border-0 p-0 transition-all ${activeSlide === index ? "w-7 bg-white" : "w-2 bg-white/65"}`}
            />
          ))}
        </div>
      </section>

      <section aria-label="Quick actions" className="mx-[15px] mt-[14px] grid grid-cols-4 rounded-2xl bg-white px-2 py-3 shadow-[0_2px_10px_rgba(30,50,120,0.08)]">
        <QuickAction
          label="Deposit"
          icon={<IconDeposit width={25} height={25} />}
          color="bg-[#38c783]"
          onClick={() => navigate("/deposit")}
        />
        <QuickAction
          label="Withdraw"
          icon={<IconWithdraw width={25} height={25} />}
          color="bg-[#f2a62b]"
          onClick={() => navigate("/withdraw")}
        />
        <QuickAction
          label="Service"
          icon={<IconHeadset width={25} height={25} />}
          color="bg-[#4b83ec]"
          href={communityLinks.serviceChatUrl}
          onClick={() => toast("The service chat link has not been set by an administrator yet.", "error")}
        />
        <QuickAction
          label="Group"
          icon={<IconTelegram width={25} height={25} />}
          color="bg-[#8050e9]"
          href={communityLinks.telegramGroupUrl}
          onClick={() => toast("The Telegram group link has not been set by an administrator yet.", "error")}
        />
      </section>

      <div role="tablist" aria-label="Home content" className="mx-[15px] mt-[14px] grid grid-cols-2 rounded-2xl border border-[#6a809c] bg-white p-[6px]">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "earnings"}
          onClick={() => setActiveTab("earnings")}
          className={`h-[44px] rounded-xl text-[14px] font-medium transition-colors ${activeTab === "earnings" ? "bg-primary text-white shadow-sm" : "bg-transparent text-ink-soft"}`}
        >
          Daily Earnings
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "plans"}
          onClick={() => setActiveTab("plans")}
          className={`h-[44px] rounded-xl text-[14px] font-medium transition-colors ${activeTab === "plans" ? "bg-primary text-white shadow-sm" : "bg-transparent text-ink-soft"}`}
        >
          Test Plans
        </button>
      </div>

      <section role="tabpanel" className="mt-[14px] px-[15px]">
        {activeTab === "plans" ? (
          <TestPlans
            products={products}
            purchaseCounts={purchaseCounts}
            loading={loading}
            onSelect={setSelected}
          />
        ) : (
          <DailyEarnings
            investments={investments}
            loading={loading}
            claiming={claiming}
            onClaim={(investment) => void claimEarnings(investment)}
            onViewAll={() => navigate("/income")}
            onBrowsePlans={() => setActiveTab("plans")}
          />
        )}
      </section>

      {selected && (
        <InvestSheet
          product={selected}
          onClose={() => setSelected(null)}
          onSuccess={() => {
            setPurchaseCounts((counts) => ({
              ...counts,
              [selected.id]: (counts[selected.id] ?? 0) + 1,
            }));
            if (profile?.id) {
              void fetchInvestments(getSupabaseBrowserClient(), profile.id)
                .then(setInvestments)
                .catch(() => toast("Your plan progress could not be refreshed.", "error"));
            }
          }}
        />
      )}
      {profile?.id && (
        <WelcomeDialog
          userId={profile.id}
          groupUrl={communityLinks.telegramGroupUrl}
          serviceUrl={communityLinks.serviceChatUrl}
          settings={appSettings}
          welcomeMessage={appSettings.welcome_message}
          onStorageError={() => toast("The welcome notice may appear again next time.", "error")}
        />
      )}
    </main>
  );
}

function WelcomeDialog({
  userId,
  groupUrl,
  serviceUrl,
  settings,
  welcomeMessage,
  onStorageError,
}: {
  userId: string;
  groupUrl: string;
  serviceUrl: string;
  settings: AdminSettings;
  welcomeMessage: string;
  onStorageError: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    try {
      if (window.localStorage.getItem(`testinglives-welcome-dismissed:${userId}`) === welcomeMessage) {
        if (dialog.open) dialog.close();
        return;
      }
    } catch {
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }, [userId, welcomeMessage]);

  function dismiss() {
    try {
      window.localStorage.setItem(`testinglives-welcome-dismissed:${userId}`, welcomeMessage);
    } catch {
      onStorageError();
    }
    dialogRef.current?.close();
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="welcome-title" className="m-auto max-h-[calc(100%-32px)] w-[calc(100%-32px)] max-w-[420px] overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl backdrop:bg-ink/60 backdrop:backdrop-blur-sm">
        <div className="mb-4 flex items-center gap-3">
          <Image src="/images/logo.jpg" alt="Testing Lives logo" width={56} height={56} className="h-14 w-14 rounded-full object-cover" />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-primary">Testing Lives</p>
            <h2 id="welcome-title" className="m-0 mt-1 text-[20px] font-bold text-ink">Welcome</h2>
          </div>
          <button type="button" onClick={dismiss} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-muted" aria-label="Close welcome message">
            Close
          </button>
        </div>
        <p className="m-0 mb-4 text-[13px] leading-relaxed text-ink-soft">{settings.welcome_message}</p>
        <dl className="divide-y divide-line-blue rounded-xl border border-line-blue text-[13px] text-ink-soft">
          <WelcomeRow label="Plan earnings" value="Follow the terms shown for each active plan." />
          <WelcomeRow label="Withdrawal hours" value={`${settings.withdrawal_start}–${settings.withdrawal_end} Kampala time`} />
          <WelcomeRow label="Minimum withdrawal" value={`UGX ${formatMoney(settings.minimum_withdrawal)}`} />
          <WelcomeRow label="Withdrawal fee" value={`${settings.withdrawal_fee_percent}%`} />
          <WelcomeRow label="Payout review" value="An administrator reviews requests before payment." />
        </dl>
        <p className="mb-0 mt-4 text-center text-[13px] leading-relaxed text-ink-soft">Official support will never ask for your password or screenshots of your deposits. Keep your account details private.</p>
        <div className="mt-4 grid gap-2">
          {groupUrl ? (
            <a href={groupUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 text-[14px] font-bold text-white">
              Join the Telegram group
            </a>
          ) : (
            <p className="m-0 rounded-xl bg-page px-4 py-3 text-center text-[12px] text-muted">The community group link is not available yet.</p>
          )}
          {serviceUrl && (
            <a href={serviceUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-center rounded-xl border border-primary/30 px-4 text-[13px] font-semibold text-primary">
              Contact service
            </a>
          )}
        </div>
    </dialog>
  );
}

function WelcomeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-3">
      <dt className="font-medium">{label}</dt>
      <dd className="m-0 max-w-[60%] text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  color,
  onClick,
  href,
}: {
  icon: ReactNode;
  label: string;
  color: string;
  onClick: () => void;
  href?: string;
}) {
  const content = (
    <>
      <span className={`grid h-[56px] w-[56px] place-items-center rounded-full text-white shadow-[0_5px_10px_rgba(30,50,120,0.18)] ${color}`}>
        {icon}
      </span>
      <span className="mt-1 text-[12px] font-semibold leading-tight text-ink">{label}</span>
    </>
  );
  const className = "flex min-w-0 flex-col items-center justify-center rounded-xl py-1 text-center transition-transform active:scale-[0.97]";

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function TestPlans({
  products,
  purchaseCounts,
  loading,
  onSelect,
}: {
  products: Product[];
  purchaseCounts: Record<string, number>;
  loading: boolean;
  onSelect: (product: Product) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((index) => <div key={index} className="h-[214px] animate-pulse rounded-2xl bg-white/80" />)}
      </div>
    );
  }

  if (products.length === 0) {
    return <p className="m-0 rounded-2xl bg-white px-4 py-6 text-center text-[13px] text-muted">No test plans are available right now.</p>;
  }

  return (
    <div className="space-y-3">
      <h1 className="m-0 text-[18px] font-extrabold text-ink">Test plans</h1>
      <p className="m-0 text-[12px] leading-relaxed text-muted">Plan and referral terms are separate from healthcare. Testing is voluntary, and test results stay private.</p>
      {products.map((product) => {
        const purchaseCount = purchaseCounts[product.id] ?? 0;
        const limitReached = purchaseCount >= 3;
        return (
          <article key={product.id} className="grid grid-cols-[40%_1fr] gap-x-3 gap-y-3 rounded-2xl bg-white p-3 shadow-[0_2px_10px_rgba(30,50,120,0.08)]">
            <div className="relative min-h-[160px] overflow-hidden rounded-xl bg-page">
              <Image src={product.image} alt={product.name} fill sizes="180px" className="object-cover" />
              <span className="absolute left-0 top-0 rounded-br-lg bg-primary/90 px-2 py-1 text-[10px] font-medium text-white">
                Times {purchaseCount}/3
              </span>
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-7 text-[12px] font-semibold text-white">
                {product.name}
              </span>
            </div>
            <dl className="m-0 flex min-w-0 flex-col justify-between gap-1 text-[12px]">
              <PlanValue label="Price" value={`UGX ${formatMoney(product.price)}`} />
              <PlanValue label="Daily earnings" value={`UGX ${formatMoney(product.daily_income)}`} emphasis="success" />
              <PlanValue label="Days" value={String(product.duration_days)} />
              <PlanValue label="Total earnings" value={`UGX ${formatMoney(product.daily_income * product.duration_days)}`} emphasis="primary" />
            </dl>
            <button
              type="button"
              onClick={() => onSelect(product)}
              disabled={limitReached}
              className="col-span-2 h-[40px] rounded-lg bg-primary text-[13px] font-semibold text-white disabled:bg-muted"
            >
              {limitReached ? "Test limit reached" : "Test"}
            </button>
          </article>
        );
      })}
    </div>
  );
}

function PlanValue({ label, value, emphasis }: { label: string; value: string; emphasis?: "success" | "primary" }) {
  const valueColor = emphasis === "success" ? "text-success" : emphasis === "primary" ? "text-primary" : "text-[#245a9d]";
  return (
    <div className="flex min-h-[32px] items-center justify-between gap-1 rounded-lg bg-[#f3f6fc] px-2">
      <dt className="min-w-0 truncate text-ink-soft">{label}</dt>
      <dd className={`m-0 shrink-0 text-right font-bold ${valueColor}`}>{value}</dd>
    </div>
  );
}

function DailyEarnings({
  investments,
  loading,
  claiming,
  onClaim,
  onViewAll,
  onBrowsePlans,
}: {
  investments: Investment[];
  loading: boolean;
  claiming: string | null;
  onClaim: (investment: Investment) => void;
  onViewAll: () => void;
  onBrowsePlans: () => void;
}) {
  const activeInvestments = investments.filter((investment) => investment.status === "active");
  const dailyTotal = activeInvestments.reduce((total, investment) => total + investment.daily_income, 0);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white p-4 shadow-[0_2px_10px_rgba(30,50,120,0.08)]">
        <p className="m-0 text-[12px] font-medium text-ink-soft">Potential daily earnings</p>
        <p className="m-0 mt-1 text-[24px] font-extrabold text-primary">UGX {formatMoney(dailyTotal)}</p>
        <p className="m-0 mt-1 text-[11px] text-muted">Across your active test plans</p>
      </div>
      {loading ? (
        <div className="h-[155px] animate-pulse rounded-2xl bg-white/80" />
      ) : investments.length === 0 ? (
        <div className="rounded-2xl bg-white px-4 py-6 text-center">
          <p className="m-0 text-[13px] font-semibold text-ink">No invested test plans yet</p>
          <button type="button" onClick={onBrowsePlans} className="mt-3 rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-white">Browse test plans</button>
        </div>
      ) : (
        <div className="space-y-3">
          {investments.map((investment) => {
            const elapsedDays = daysElapsed(investment.started_at, investment.ends_at);
            const progressDays = Math.min(investment.duration_days, elapsedDays);
            const availableDays = Math.max(0, progressDays - investment.claimed_days);
            const progress = Math.round((progressDays / investment.duration_days) * 100);
            return (
              <article key={investment.id} className="rounded-2xl bg-white p-4 shadow-[0_2px_10px_rgba(30,50,120,0.08)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="m-0 text-[14px] font-bold text-ink">{investment.product?.name ?? "Test plan"}</h2>
                    <p className="m-0 mt-1 text-[11px] text-muted">UGX {formatMoney(investment.amount)} · {investment.duration_days} days</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${investment.status === "active" ? "bg-success/10 text-success" : "bg-page text-muted"}`}>
                    {investment.status === "active" ? "Active" : "Completed"}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px]">
                  <span className="text-muted">Earning progress</span>
                  <span className="font-semibold text-ink">{progressDays}/{investment.duration_days} days</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-page">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="mb-0 mt-2 text-[11px] text-muted">
                  Claimed {investment.claimed_days} days · {availableDays > 0 ? `${availableDays} day(s) ready` : "Next earnings unlock after 24 hours"}
                </p>
                <button
                  type="button"
                  onClick={() => onClaim(investment)}
                  disabled={availableDays < 1 || investment.status !== "active" || claiming === investment.id}
                  className="mt-3 h-10 w-full rounded-lg bg-primary text-[12px] font-semibold text-white disabled:bg-muted"
                >
                  {claiming === investment.id ? "Claiming..." : availableDays > 0 ? `Claim UGX ${formatMoney(availableDays * investment.daily_income)}` : "No earnings ready"}
                </button>
              </article>
            );
          })}
        </div>
      )}
      {investments.length > 0 && (
        <button type="button" onClick={onViewAll} className="h-10 w-full rounded-lg border border-primary/30 bg-white text-[12px] font-semibold text-primary">
          View full earnings and test verification
        </button>
      )}
    </div>
  );
}
