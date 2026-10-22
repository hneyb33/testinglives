export type Profile = {
  id: string;
  phone: string;
  referral_code: string;
  referred_by: string | null;
  balance: number;
  created_at: string;
};

export type Product = {
  id: string;
  name: string;
  image: string;
  price: number;
  daily_income: number;
  duration_days: number;
  active: boolean;
};

export type CommunityLinks = {
  serviceChatUrl: string;
  telegramGroupUrl: string;
};

export type Investment = {
  id: string;
  user_id: string;
  product_id: string;
  amount: number;
  daily_income: number;
  duration_days: number;
  claimed_days: number;
  status: "active" | "completed";
  test_status?: "not_started" | "pending" | "approved" | "rejected";
  test_completed_at?: string | null;
  referral_bonus_paid?: boolean;
  started_at: string;
  ends_at: string;
  product?: Product;
};

export type TransactionKind = "deposit" | "withdraw" | "invest" | "income" | "rebate" | "adjustment";
export type PaymentProvider = "mtn" | "airtel";

export type Transaction = {
  id: string;
  user_id: string;
  member_phone?: string | null;
  kind: TransactionKind;
  amount: number;
  status: "pending" | "processing" | "approved" | "rejected";
  note: string | null;
  fee?: number;
  net_amount?: number | null;
  payment_phone?: string | null;
  payment_provider?: PaymentProvider | null;
  payment_reference?: string | null;
  provider_transaction_id?: string | null;
  failure_reason?: string | null;
  created_at: string;
};

export type PendingWithdrawal = Pick<
  Transaction,
  "id" | "user_id" | "member_phone" | "amount" | "fee" | "net_amount" | "payment_phone" | "payment_provider" | "payment_reference" | "provider_transaction_id" | "failure_reason" | "status" | "created_at"
>;

export type BankAccount = {
  id: string;
  user_id: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  created_at: string;
};

export type TeamMember = {
  id: string;
  phone: string;
  created_at: string;
  level: number;
  invested: number;
};

export type TabKey = "home" | "assets" | "network" | "share" | "account";

export type Route = {
  path: string;
  params: URLSearchParams;
};

export const DIAL_CODE = "+256";
