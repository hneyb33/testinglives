"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { formatMoney, investInProduct } from "@/lib/app-data";
import type { Product } from "@/lib/types";
import { useApp } from "./AppContext";
import { IconClose } from "./Icons";

export function InvestSheet({ product, onClose, onSuccess }: { product: Product; onClose: () => void; onSuccess: () => void }) {
  const { refreshProfile, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleInvest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await investInProduct(getSupabaseBrowserClient(), product.id);
      await refreshProfile();
      onSuccess();
      toast("Investment confirmed.");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Investment could not be completed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-labelledby="invest-title">
      <button type="button" aria-label="Close investment details" className="absolute inset-0 cursor-default" onClick={onClose} />
      <form className="sheet-panel relative" onSubmit={handleInvest}>
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <h2 id="invest-title" className="m-0 text-[20px] font-extrabold text-ink">Review plan</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="px-5 pb-6">
          <div className="relative h-[150px] overflow-hidden rounded-xl">
            <Image src={product.image} alt={product.name} fill className="object-cover" sizes="440px" />
          </div>
          <h3 className="mb-0 mt-4 text-[17px] font-bold text-ink">{product.name}</h3>
          <dl className="mb-0 mt-3 space-y-2 text-[14px]">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Plan price</dt>
              <dd className="m-0 font-semibold text-ink">UGX {formatMoney(product.price)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Daily income</dt>
              <dd className="m-0 font-semibold text-success">UGX {formatMoney(product.daily_income)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Duration</dt>
              <dd className="m-0 font-semibold text-ink">{product.duration_days} days</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-line-blue/60 pt-2">
              <dt className="font-semibold text-ink">Potential total earnings</dt>
              <dd className="m-0 font-bold text-success">UGX {formatMoney(product.daily_income * product.duration_days)}</dd>
            </div>
          </dl>
          <p className="mb-0 mt-4 text-[12px] leading-relaxed text-muted">This plan is separate from clinical care. HIV testing is voluntary, and Testing Lives does not collect or share test results.</p>
          {error && <p className="mb-0 mt-4 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-5 h-11 w-full rounded-full bg-primary text-[14px] font-bold text-white"
          >
            {busy ? "Processing..." : "Confirm plan purchase"}
          </button>
        </div>
      </form>
    </div>
  );
}