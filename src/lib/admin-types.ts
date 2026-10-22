import type { Product } from "./types";

export type AdminSettings = {
  minimum_deposit: number;
  minimum_withdrawal: number;
  withdrawal_start: string;
  withdrawal_end: string;
  withdrawal_fee_percent: number;
  referral_reward_percent: number;
  referral_rule: string;
  welcome_message: string;
};

export type AdminTransaction = {
  id: string;
  user_id: string;
  kind: "deposit" | "withdraw";
  amount: number;
  fee: number;
  net_amount: number | null;
  status: "pending" | "processing" | "approved" | "rejected";
  note: string | null;
  payment_phone: string | null;
  payment_provider: "mtn" | "airtel" | null;
  payment_reference: string | null;
  provider_transaction_id: string | null;
  failure_reason: string | null;
  admin_reason: string | null;
  payout_method: "manual" | "api";
  manual_payment_reference: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  member_phone: string;
  approved_by_phone: string | null;
};

export type AdminMember = {
  id: string;
  phone: string;
  email: string | null;
  referral_code: string;
  balance: number;
  created_at: string;
  is_banned: boolean;
  ban_reason: string | null;
  deposited: number;
  withdrawn: number;
  invested: number;
  credited: number;
  deducted: number;
  is_admin: boolean;
};

export type AdminReferral = {
  id: string;
  phone: string;
  referral_code: string;
  created_at: string;
  referrer_id: string;
  referrer_phone: string;
  referrer_code: string;
  invested: number;
  commission_paid: number;
};

export type AdminActiveTest = {
  id: string;
  user_id: string;
  phone: string;
  product_id: string;
  plan_name: string;
  amount: number;
  daily_income: number;
  duration_days: number;
  claimed_days: number;
  started_at: string;
  ends_at: string;
  test_status: string;
  elapsed_days: number;
};

export type AdminProduct = Pick<Product, "id" | "name" | "price" | "daily_income" | "duration_days" | "active">;

export type AdminSummary = {
  total_members: number;
  joined_today: number;
  joined_yesterday: number;
  deposits_pending: number;
  withdrawals_pending: number;
  deposited: number;
  withdrawn: number;
  invested: number;
  returns_paid: number;
  test_plan_volume: number;
  referral_commission_paid: number;
  member_wallet_balance: number;
  active_test_plans: number;
  net_revenue_collected: number;
  referral_links_sent: number;
};

export type AdminDashboardData = {
  overview: AdminSummary;
  transactions: AdminTransaction[];
  members: AdminMember[];
  referrals: AdminReferral[];
  active_tests: AdminActiveTest[];
  products: AdminProduct[];
  admins: Array<{ id: string; phone: string; email: string | null; created_at: string }>;
  settings: AdminSettings;
  community: { service_chat_url: string; telegram_group_url: string };
};
