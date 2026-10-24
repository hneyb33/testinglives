import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BankAccount,
  CommunityLinks,
  Investment,
  PendingWithdrawal,
  Product,
  Profile,
  TeamMember,
  Transaction,
} from "./types";
import type { AdminDashboardData, AdminSettings, AdminSummary } from "./admin-types";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { normalizeUgandaPhone } from "@/lib/phone";

export const PHONE_EMAIL_DOMAIN = "testinglives.com";

const EMPTY_COMMUNITY_LINKS: CommunityLinks = {
  serviceChatUrl: "",
  telegramGroupUrl: "",
};

export function phoneToEmail(dial: string, phone: string) {
  const normalized = normalizeUgandaPhone(phone) ?? normalizeUgandaPhone(`${dial}${phone}`);
  const address = normalized?.replace("+", "") ?? `${dial.replace("+", "")}${phone}`;
  return `${address}@${PHONE_EMAIL_DOMAIN}`;
}

export function legacyPhoneToEmail(dial: string, phone: string) {
  return `${dial.replace("+", "")}${phone.replace(/\D/g, "")}@${PHONE_EMAIL_DOMAIN}`;
}

export async function fetchCommunityLinks(client: SupabaseClient): Promise<CommunityLinks> {
  const { data, error } = await client
    .from("community_settings")
    .select("service_chat_url, telegram_group_url")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return data
    ? { serviceChatUrl: data.service_chat_url, telegramGroupUrl: data.telegram_group_url }
    : EMPTY_COMMUNITY_LINKS;
}

export async function saveCommunityLinks(client: SupabaseClient, links: CommunityLinks) {
  const { error } = await client.from("community_settings").upsert({
    id: 1,
    service_chat_url: links.serviceChatUrl,
    telegram_group_url: links.telegramGroupUrl,
  });
  if (error) throw error;
}

export async function fetchPublicAppSettings(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_public_app_settings");
  if (error) throw error;
  const settings: unknown = data;
  if (!isAdminSettings(settings)) throw new Error("Application settings returned an unexpected response.");
  return settings;
}

export async function fetchAdminDashboard(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_admin_dashboard_data");
  if (error) throw error;
  const dashboard: unknown = data;
  if (!isAdminDashboardData(dashboard)) throw new Error("Admin dashboard returned an unexpected response.");
  return dashboard;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isAdminSettings(value: unknown): value is AdminSettings {
  return isRecord(value)
    && typeof value.minimum_deposit === "number"
    && typeof value.minimum_withdrawal === "number"
    && typeof value.withdrawal_start === "string"
    && typeof value.withdrawal_end === "string"
    && typeof value.withdrawal_fee_percent === "number"
    && typeof value.referral_reward_percent === "number"
    && typeof value.referral_rule === "string"
    && typeof value.welcome_message === "string";
}

function isAdminTransaction(value: unknown) {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.user_id === "string"
    && (value.kind === "deposit" || value.kind === "withdraw")
    && isNumber(value.amount)
    && isNumber(value.fee)
    && (isNumber(value.net_amount) || value.net_amount === null)
    && ["pending", "processing", "approved", "rejected"].includes(String(value.status))
    && isNullableString(value.note)
    && isNullableString(value.payment_phone)
    && (value.payment_provider === "mtn" || value.payment_provider === "airtel" || value.payment_provider === null)
    && isNullableString(value.payment_reference)
    && isNullableString(value.provider_transaction_id)
    && isNullableString(value.failure_reason)
    && isNullableString(value.admin_reason)
    && (value.payout_method === "manual" || value.payout_method === "api")
    && isNullableString(value.manual_payment_reference)
    && isNullableString(value.approved_by)
    && isNullableString(value.approved_at)
    && typeof value.created_at === "string"
    && typeof value.member_phone === "string"
    && isNullableString(value.approved_by_phone);
}

function isAdminMember(value: unknown) {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.phone === "string"
    && isNullableString(value.email)
    && typeof value.referral_code === "string"
    && isNumber(value.balance)
    && typeof value.created_at === "string"
    && typeof value.is_banned === "boolean"
    && isNullableString(value.ban_reason)
    && isNumber(value.deposited)
    && isNumber(value.withdrawn)
    && isNumber(value.invested)
    && isNumber(value.credited)
    && isNumber(value.deducted)
    && typeof value.is_admin === "boolean";
}

function isAdminReferral(value: unknown) {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.phone === "string"
    && typeof value.referral_code === "string"
    && typeof value.created_at === "string"
    && typeof value.referrer_id === "string"
    && typeof value.referrer_phone === "string"
    && typeof value.referrer_code === "string"
    && isNumber(value.invested)
    && isNumber(value.commission_paid);
}

function isAdminActiveTest(value: unknown) {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.user_id === "string"
    && typeof value.phone === "string"
    && typeof value.product_id === "string"
    && typeof value.plan_name === "string"
    && isNumber(value.amount)
    && isNumber(value.daily_income)
    && isNumber(value.duration_days)
    && isNumber(value.claimed_days)
    && typeof value.started_at === "string"
    && typeof value.ends_at === "string"
    && typeof value.test_status === "string"
    && isNumber(value.elapsed_days);
}

function isAdminProduct(value: unknown) {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && isNumber(value.price)
    && isNumber(value.daily_income)
    && isNumber(value.duration_days)
    && typeof value.active === "boolean";
}

function isAdminSummary(value: unknown): value is AdminSummary {
  if (!isRecord(value)) return false;
  return [
    "total_members", "joined_today", "joined_yesterday", "deposits_pending",
    "withdrawals_pending", "deposited", "withdrawn", "invested", "returns_paid",
    "test_plan_volume", "referral_commission_paid", "member_wallet_balance",
    "active_test_plans", "net_revenue_collected", "referral_links_sent",
  ].every((key) => isNumber(value[key]));
}

function isAdminDashboardData(value: unknown): value is AdminDashboardData {
  return isRecord(value)
    && isAdminSummary(value.overview)
    && isAdminSettings(value.settings)
    && isRecord(value.community)
    && typeof value.community.service_chat_url === "string"
    && typeof value.community.telegram_group_url === "string"
    && Array.isArray(value.transactions) && value.transactions.every(isAdminTransaction)
    && Array.isArray(value.members) && value.members.every(isAdminMember)
    && Array.isArray(value.referrals) && value.referrals.every(isAdminReferral)
    && Array.isArray(value.active_tests) && value.active_tests.every(isAdminActiveTest)
    && Array.isArray(value.products) && value.products.every(isAdminProduct)
    && Array.isArray(value.admins) && value.admins.every((admin: unknown) =>
      isRecord(admin)
      && typeof admin.id === "string"
      && typeof admin.phone === "string"
      && isNullableString(admin.email)
      && typeof admin.created_at === "string",
    );
}

export async function saveAdminSettings(
  client: SupabaseClient,
  settings: AdminSettings,
  links: CommunityLinks,
) {
  const { error } = await client.rpc("admin_save_app_settings", {
    p_minimum_deposit: settings.minimum_deposit,
    p_minimum_withdrawal: settings.minimum_withdrawal,
    p_withdrawal_start: settings.withdrawal_start,
    p_withdrawal_end: settings.withdrawal_end,
    p_withdrawal_fee_percent: settings.withdrawal_fee_percent,
    p_referral_reward_percent: settings.referral_reward_percent,
    p_referral_rule: settings.referral_rule,
    p_welcome_message: settings.welcome_message,
    p_service_chat_url: links.serviceChatUrl,
    p_telegram_group_url: links.telegramGroupUrl,
  });
  if (error) throw error;
}

export async function updateAdminProduct(
  client: SupabaseClient,
  product: { id: string; name: string; price: number; daily_income: number; duration_days: number; active: boolean },
) {
  const { error } = await client.rpc("admin_update_product", {
    p_product_id: product.id,
    p_name: product.name,
    p_price: product.price,
    p_daily_income: product.daily_income,
    p_duration_days: product.duration_days,
    p_active: product.active,
  });
  if (error) throw error;
}

export async function adjustMemberBalance(
  client: SupabaseClient,
  memberId: string,
  direction: "credit" | "debit",
  amount: number,
  reason: string,
) {
  const { error } = await client.rpc("admin_adjust_member_balance", {
    p_member_id: memberId,
    p_direction: direction,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function setWithdrawalMethod(
  client: SupabaseClient,
  transactionId: string,
  method: "manual" | "api",
) {
  const { error } = await client.rpc("admin_set_withdrawal_method", {
    p_transaction_id: transactionId,
    p_method: method,
  });
  if (error) throw error;
}

export async function manageWithdrawal(
  client: SupabaseClient,
  transactionId: string,
  action: "reject" | "approve_manual" | "manual_paid" | "manual_failed",
  reason = "",
  manualReference = "",
) {
  const { error } = await client.rpc("admin_withdrawal_action", {
    p_transaction_id: transactionId,
    p_action: action,
    p_reason: reason,
    p_manual_reference: manualReference,
  });
  if (error) throw error;
}

export async function reviewAdminDeposit(
  client: SupabaseClient,
  transactionId: string,
  action: "approve" | "reject",
  reason = "",
) {
  const { error } = await client.rpc("admin_review_deposit", {
    p_transaction_id: transactionId,
    p_action: action,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function logReferralShare(client: SupabaseClient) {
  const { error } = await client.rpc("admin_log_referral_share");
  if (error) throw error;
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

export async function fetchTransactions(client: SupabaseClient, userId: string, offset = 0, limit = 100) {
  const { data, error } = await client
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)
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
  promptSent?: boolean;
  message?: string;
};

async function postAuthenticatedPayment<T>(
  path: string,
  payload: unknown,
  method: "POST" | "PATCH" = "POST",
): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new Error("Sign in to continue.");

  const response = await fetch(path, {
    method,
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

export async function requestDeposit(amount: number, phone: string, provider?: "mtn" | "airtel") {
  return postAuthenticatedPayment<PaymentApiResult>("/api/payments/deposit", { amount, phone, provider });
}

export async function requestWithdrawal(amount: number, phone: string, provider?: "mtn" | "airtel") {
  return postAuthenticatedPayment<PaymentApiResult>("/api/payments/withdrawal", { amount, phone, provider });
}

export async function fetchPendingWithdrawals(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_pending_marzpay_withdrawals").returns<PendingWithdrawal[]>();
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchAdminTransactions(client: SupabaseClient, offset = 0, limit = 100) {
  const { data, error } = await client.rpc("get_admin_transaction_log", {
    p_limit: limit,
    p_offset: offset,
  }).returns<Transaction[]>();
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

type MarzPayDepositCheckResult = {
  transactionId: string;
  status: string;
  message: string;
};

export type MarzPayReconcileResult = {
  total: number;
  checked: number;
  updated: number;
  failed: number;
  errors: string[];
  message: string;
};

export async function checkMarzPayDeposit(transactionId: string) {
  return postAuthenticatedPayment<MarzPayDepositCheckResult>(`/api/admin/deposits/${transactionId}/check`, {});
}

export async function reconcileMarzPayDeposits() {
  return postAuthenticatedPayment<MarzPayReconcileResult>("/api/admin/deposits/reconcile", {});
}

export async function approveWithdrawal(transactionId: string) {
  return postAuthenticatedPayment<PaymentApiResult>(`/api/admin/withdrawals/${transactionId}/approve`, {});
}

export async function rejectWithdrawal(transactionId: string) {
  return postAuthenticatedPayment<PaymentApiResult>(`/api/admin/withdrawals/${transactionId}/reject`, {});
}

export async function updateMemberBan(memberId: string, banned: boolean, reason = "") {
  return postAuthenticatedPayment<{ userId: string; banned: boolean }>(
    `/api/admin/members/${memberId}`,
    { banned, reason },
    "PATCH",
  );
}

export async function promoteAdmin(phone: string) {
  return postAuthenticatedPayment<{ userId: string }>(
    "/api/admin/admins",
    { phone },
  );
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
