"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { fetchInvestments, fetchProducts, formatMoney } from "@/lib/app-data";
import type { Product } from "@/lib/types";
import { useApp } from "./AppContext";
import { IconDeposit, IconEye, IconEyeOff, IconInfo, IconRecords, IconWithdraw } from "./Icons";
import { InvestSheet } from "./InvestSheet";

export function HomePage() {
  const { profile, balanceVisible, toggleBalanceVisible, navigate, toast } = useApp();
  const [products, setProducts] = useState<Product[]>([]);
  const [purchaseCounts, setPurchaseCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const userId = profile?.id;
    (async () => {
      try {
        const client = getSupabaseBrowserClient();
        const list = await fetchProducts(client);
        if (active) setProducts(list);
        if (userId) {
          const investments = await fetchInvestments(client, userId);
          if (active) {
            setPurchaseCounts(investments.reduce<Record<string, number>>((counts, investment) => {
              counts[investment.product_id] = (counts[investment.product_id] ?? 0) + 1;
              return counts;
            }, {}));
          }
        }
      } catch {
        if (active) toast("Could not load products.", "error");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [profile?.id, toast]);

  const balance = profile?.balance ?? 0;

  return (
    <div className="pb-[92px]">
      <header className="relative h-[150px] w-full overflow-hidden">
        <Image
          src="/images/app/auth-hero.jpg"
          alt=""
          fill
          priority
          className="object-cover"
          sizes="480px"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-primary/70 via-primary-mid/40 to-transparent" />
        <div className="absolute left-[18px] top-[22px] text-white">
          <p className="m-0 text-[13px] font-medium text-white/85">Welcome to Testing Lives</p>
          <p className="m-0 mt-[2px] text-[17px] font-bold">{profile?.phone ?? "Community member"}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/pages/about/index")}
          className="absolute right-[16px] top-[18px] rounded-full bg-white/20 p-2 text-white backdrop-blur-sm"
          aria-label="About Testing Lives"
        >
          <IconInfo width={21} height={21} />
        </button>
      </header>

      <section className="relative z-10 mx-[15px] -mt-[98px] flex h-[82px] items-center justify-between rounded-2xl px-5 text-white shadow-[0_12px_26px_-14px_rgba(7,60,180,0.7)]"
        style={{ background: "linear-gradient(180deg,#5a91ec 0%,#1a66e6 100%)" }}
      >
        <div>
          <p className="m-0 flex items-center gap-2 text-[12.5px] font-medium text-white/85">
            Total Balance (UGX)
            <button type="button" onClick={toggleBalanceVisible} className="text-white/90" aria-label="Toggle balance visibility">
              {balanceVisible ? <IconEyeOff width={17} height={17} /> : <IconEye width={17} height={17} />}
            </button>
          </p>
          <p className="m-0 mt-[5px] text-[24px] font-bold leading-none tracking-tight">
            {balanceVisible ? formatMoney(balance) : "****"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/pages/records/index")}
          className="rounded-full bg-white/20 px-3.5 py-1.5 text-[12px] font-semibold text-white backdrop-blur-sm"
        >
          Records
        </button>
      </section>

      <section className="mx-[15px] mt-[16px] grid grid-cols-3 gap-[10px]">
        <QuickAction
          icon={<IconDeposit className="text-primary" width={26} height={26} />}
          label="Deposit"
          onClick={() => navigate("/pages/deposit/index")}
        />
        <QuickAction
          icon={<IconWithdraw className="text-primary" width={26} height={26} />}
          label="Withdraw"
          onClick={() => navigate("/pages/withdraw/index")}
        />
        <QuickAction
          icon={<IconRecords className="text-primary" width={26} height={26} />}
          label="Records"
          onClick={() => navigate("/pages/records/index")}
        />
      </section>

      <section className="relative mx-[15px] mt-[16px] aspect-[3/2] overflow-hidden rounded-xl bg-white">
        <Image
          src="/images/about-us.jpg"
          alt="Testing Lives promotes voluntary HIV testing, qualified care, clear referral terms, and confidential results."
          fill
          className="object-contain"
          sizes="450px"
        />
      </section>

      <p className="mx-[18px] mb-0 mt-3 text-[12px] leading-relaxed text-ink-soft">
        We share trusted HIV awareness information. Testing and medical care are always voluntary choices made with qualified providers.
      </p>

      <section className="mt-[20px] px-[15px]">
        <div className="mb-[12px] flex items-end justify-between">
          <h2 className="m-0 text-[18px] font-extrabold text-ink">Community plans</h2>
          <span className="text-[12px] font-medium text-muted">{products.length} plans</span>
        </div>
        <p className="mb-3 mt-0 text-[12px] leading-relaxed text-muted">Plan and referral terms are separate from healthcare. No referral reward is based on HIV status or test results.</p>
        {loading ? (
          <div className="grid grid-cols-2 gap-[12px]">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[260px] animate-pulse rounded-2xl bg-white/70" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-[12px]">
            {products.map((product) => (
              <article
                key={product.id}
                className="overflow-hidden rounded-2xl border border-line-blue/50 bg-white shadow-[0_2px_10px_rgba(30,50,120,0.08)]"
              >
                <div className="relative h-[104px] w-full">
                  <Image
                    src={product.image}
                    alt={product.name}
                    fill
                    className="object-cover"
                    sizes="220px"
                  />
                </div>
                <div className="p-[11px]">
                  <p className="m-0 truncate text-[14px] font-bold text-ink">{product.name}</p>
                  <p className="m-0 mt-[3px] text-[12px] text-muted">
                    Price{" "}
                    <span className="font-semibold text-primary">
                      UGX {formatMoney(product.price)}
                    </span>
                  </p>
                  <p className="m-0 mt-[1px] text-[12px] text-muted">
                    Daily earnings{" "}
                    <span className="font-semibold text-success">
                      +{formatMoney(product.daily_income)}
                    </span>
                  </p>
                  <p className="m-0 mt-[1px] text-[12px] text-muted">
                    Duration <span className="font-semibold text-ink">{product.duration_days} days</span>
                  </p>
                  <p className="m-0 mt-[1px] text-[12px] text-muted">
                    Total <span className="font-semibold text-primary">UGX {formatMoney(product.daily_income * product.duration_days)}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setSelected(product)}
                    disabled={(purchaseCounts[product.id] ?? 0) >= 3}
                    className="mt-[9px] h-[32px] w-full rounded-full bg-gradient-to-br from-[#0a56e3] via-[#2f72ea] to-[#5b91ee] text-[13px] font-bold text-white disabled:bg-muted"
                  >
                    {(purchaseCounts[product.id] ?? 0) >= 3 ? "Limit reached" : "View plan"}
                  </button>
                  <p className="m-0 mt-1 text-center text-[10px] text-muted">
                    {purchaseCounts[product.id] ?? 0}/3 purchased
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {selected && (
        <InvestSheet
          product={selected}
          onClose={() => setSelected(null)}
          onSuccess={() => setPurchaseCounts((counts) => ({
            ...counts,
            [selected.id]: (counts[selected.id] ?? 0) + 1,
          }))}
        />
      )}
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[86px] flex-col items-center justify-center gap-[8px] rounded-2xl border border-line-blue/50 bg-white text-ink shadow-[0_2px_10px_rgba(30,50,120,0.08)] transition-transform active:scale-[0.97]"
    >
      {icon}
      <span className="text-[12.5px] font-semibold">{label}</span>
    </button>
  );
}

