import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BankAccount,
  Investment,
  PaymentProvider,
  PendingWithdrawal,
  Product,
  Profile,
  TeamMember,
  Transaction,
} from "./types";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export const PHONE_EMAIL_DOMAIN = "testinglives.com";

export function phoneToEmail(dial: string, phone: string) {
  return `${dial.replace("+", "")}${phone}@${PHONE_EMAIL_DOMAIN}`;
}

export async function fetchProfile(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single<Profile>();
  if (error) throw error;
  return data;
}

export async function fetchProducts(client: SupabaseClient) {
  const { data, error } = await client
    .from("products")
    .select("*")
    .eq("active", true)
    .order("price", { ascending: true })
    .returns<Product[]>();
  if (error) throw error;
  return data ?? [];
}

export async function fetchInvestments(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from("investments")
    .select("*, product:products(*)")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .returns<Investment[]>();
  if (error) throw error;
  return data ?? [];
}

export async function fetchTransactions(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<Transaction[]>();
  if (error) throw error;
  return data ?? [];
}

export async function fetchBankAccounts(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from("bank_accounts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .returns<BankAccount[]>();
  if (error) throw error;
  return data ?? [];
}

export async function addBankAccount(
  client: SupabaseClient,
  bankName: string,
  accountName: string,
  accountNumber: string,
) {
  const { data, error } = await client.rpc("add_bank_account", {
    bank_name: bankName,
    account_name: accountName,
    account_number: accountNumber,
  });
  if (error) throw error;
  return String(data);
}

export async function referralCodeExists(client: SupabaseClient, code: string) {
  const { data, error } = await client.rpc("referral_code_exists", {
    code: code.trim().toLowerCase(),
  });
  if (error) throw error;
  return Boolean(data);
}

export async function registrationRequiresReferral(client: SupabaseClient) {
  const { data, error } = await client.rpc("registration_requires_referral_code");
  if (error) throw error;
  return Boolean(data);
}

type PaymentApiResult = {
  transactionId: string;
  providerTransactionId?: string;
  status?: string;
  message?: string;
};

async function postAuthenticatedPayment<T>(path: string, payload: unknown): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new Error("Sign in to continue.");

  const response = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(result.error ?? "The payment request could not be completed.");
  return result;
}

export async function requestDeposit(amount: number, provider: PaymentProvider) {
  return postAuthenticatedPayment<PaymentApiResult>("/api/payments/deposit", { amount, provider });
}

export async function requestWithdrawal(amount: number, provider: PaymentProvider) {
  return postAuthenticatedPayment<PaymentApiResult>("/api/payments/withdrawal", { amount, provider });
}

export async function fetchPendingWithdrawals(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_pending_pesajet_withdrawals").returns<PendingWithdrawal[]>();
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function approvePesaJetWithdrawal(transactionId: string) {
  return postAuthenticatedPayment<PaymentApiResult>(`/api/admin/withdrawals/${transactionId}/approve`, {});
}

export async function rejectPesaJetWithdrawal(transactionId: string) {
  return postAuthenticatedPayment<PaymentApiResult>(`/api/admin/withdrawals/${transactionId}/reject`, {});
}

export async function investInProduct(client: SupabaseClient, productId: string) {
  const { error } = await client.rpc("invest_in_product", { product_id: productId });
  if (error) throw error;
}

export async function submitTestCompletion(client: SupabaseClient, investmentId: string) {
  const { error } = await client.rpc("submit_test_completion", { investment_id: investmentId });
  if (error) throw error;
}

export async function claimDailyIncome(client: SupabaseClient, investmentId: string) {
  const { data, error } = await client.rpc("claim_daily_income", {
    investment_id: investmentId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function fetchTeam(client: SupabaseClient) {
  const { data, error } = await client.rpc("my_team").returns<TeamMember[]>();
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export function maskPhone(phone: string) {
  if (phone.length <= 6) return phone;
  return `${phone.slice(0, 4)}****${phone.slice(-3)}`;
}

export function formatMoney(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDate(iso: string) {
  const date = new Date(iso);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function daysElapsed(startedAt: string, endsAt: string) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endsAt).getTime();
  const now = Date.now();
  if (now <= start) return 0;
  const elapsed = Math.floor((Math.min(now, end) - start) / 86_400_000);
  return Math.max(0, elapsed);
}
