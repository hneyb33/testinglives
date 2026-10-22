alter table public.profiles
  add column if not exists is_banned boolean not null default false,
  add column if not exists ban_reason text;

alter table public.transactions
  add column if not exists admin_reason text,
  add column if not exists payout_method text not null default 'api',
  add column if not exists manual_payment_reference text,
  add column if not exists related_user_id uuid references public.profiles(id) on delete set null;

alter table public.transactions
  drop constraint if exists transactions_kind_check;
alter table public.transactions
  add constraint transactions_kind_check
  check (kind in ('deposit', 'withdraw', 'invest', 'income', 'rebate', 'adjustment'));

alter table public.transactions
  drop constraint if exists transactions_payout_method_check;
alter table public.transactions
  add constraint transactions_payout_method_check
  check (payout_method in ('manual', 'api'));

create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  minimum_deposit numeric(14, 2) not null default 10000 check (minimum_deposit >= 0),
  minimum_withdrawal numeric(14, 2) not null default 5000 check (minimum_withdrawal >= 0),
  withdrawal_start time not null default '09:00',
  withdrawal_end time not null default '21:00',
  withdrawal_fee_percent numeric(5, 2) not null default 20 check (withdrawal_fee_percent between 0 and 100),
  referral_reward_percent numeric(5, 2) not null default 15 check (referral_reward_percent between 0 and 100),
  referral_rule text not null default 'Reward is paid after a referred member reports a completed test and it is verified. Rewards never depend on HIV status or results.',
  welcome_message text not null default 'Official support will never ask for your password or screenshots of your deposits. Keep your account details private.',
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.referral_share_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists referral_share_events_user_created_idx
  on public.referral_share_events (user_id, created_at desc);

alter table public.app_settings enable row level security;
alter table public.referral_share_events enable row level security;

revoke all on public.app_settings, public.referral_share_events from anon, authenticated;

create or replace function public.get_public_app_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'minimum_deposit', minimum_deposit,
    'minimum_withdrawal', minimum_withdrawal,
    'withdrawal_start', to_char(withdrawal_start, 'HH24:MI'),
    'withdrawal_end', to_char(withdrawal_end, 'HH24:MI'),
    'withdrawal_fee_percent', withdrawal_fee_percent,
    'referral_reward_percent', referral_reward_percent,
    'referral_rule', referral_rule,
    'welcome_message', welcome_message
  )
  from public.app_settings
  where id = 1;
$$;

create or replace function public.admin_save_app_settings(
  p_minimum_deposit numeric,
  p_minimum_withdrawal numeric,
  p_withdrawal_start time,
  p_withdrawal_end time,
  p_withdrawal_fee_percent numeric,
  p_referral_reward_percent numeric,
  p_referral_rule text,
  p_welcome_message text,
  p_service_chat_url text,
  p_telegram_group_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required.';
  end if;
  if p_minimum_deposit is null or p_minimum_deposit <> trunc(p_minimum_deposit)
    or p_minimum_withdrawal is null or p_minimum_withdrawal <> trunc(p_minimum_withdrawal)
    or p_withdrawal_start is null or p_withdrawal_end is null
    or p_withdrawal_fee_percent is null or p_referral_reward_percent is null
    or p_minimum_deposit < 0 or p_minimum_withdrawal < 0
    or p_withdrawal_fee_percent not between 0 and 100
    or p_referral_reward_percent not between 0 and 100
    or p_withdrawal_start = p_withdrawal_end
    or length(trim(coalesce(p_referral_rule, ''))) > 1000
    or length(trim(coalesce(p_welcome_message, ''))) > 2000 then
    raise exception 'One or more settings are invalid.';
  end if;
  if (p_service_chat_url <> '' and p_service_chat_url !~ '^https://(t\.me|telegram\.me)/[^[:space:]]+$')
    or (p_telegram_group_url <> '' and p_telegram_group_url !~ '^https://(t\.me|telegram\.me)/[^[:space:]]+$') then
    raise exception 'Service and group destinations must be valid HTTPS Telegram links.';
  end if;

  insert into public.app_settings (
    id, minimum_deposit, minimum_withdrawal, withdrawal_start, withdrawal_end,
    withdrawal_fee_percent, referral_reward_percent, referral_rule, welcome_message, updated_at
  ) values (
    1, p_minimum_deposit, p_minimum_withdrawal, p_withdrawal_start, p_withdrawal_end,
    p_withdrawal_fee_percent, p_referral_reward_percent, trim(p_referral_rule), trim(p_welcome_message), now()
  )
  on conflict (id) do update set
    minimum_deposit = excluded.minimum_deposit,
    minimum_withdrawal = excluded.minimum_withdrawal,
    withdrawal_start = excluded.withdrawal_start,
    withdrawal_end = excluded.withdrawal_end,
    withdrawal_fee_percent = excluded.withdrawal_fee_percent,
    referral_reward_percent = excluded.referral_reward_percent,
    referral_rule = excluded.referral_rule,
    welcome_message = excluded.welcome_message,
    updated_at = now();

  insert into public.community_settings (id, service_chat_url, telegram_group_url, updated_at)
  values (1, trim(p_service_chat_url), trim(p_telegram_group_url), now())
  on conflict (id) do update set
    service_chat_url = excluded.service_chat_url,
    telegram_group_url = excluded.telegram_group_url,
    updated_at = now();
end;
$$;

create or replace function public.admin_update_product(
  p_product_id uuid,
  p_name text,
  p_price numeric,
  p_daily_income numeric,
  p_duration_days integer,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required.';
  end if;
  if p_product_id is null or p_active is null
    or trim(coalesce(p_name, '')) = '' or p_price is null or p_daily_income is null
    or p_price <= 0 or p_daily_income <= 0
    or p_duration_days < 1 or p_duration_days > 3650 then
    raise exception 'Plan name, price, daily return, or duration is invalid.';
  end if;

  update public.products
  set name = trim(p_name), price = p_price, daily_income = p_daily_income,
      duration_days = p_duration_days, active = p_active
  where id = p_product_id;
  if not found then raise exception 'Test plan not found.'; end if;
end;
$$;

create or replace function public.admin_adjust_member_balance(
  p_member_id uuid,
  p_direction text,
  p_amount numeric,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  member_balance numeric(14, 2);
  signed_amount numeric(14, 2);
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required.';
  end if;
  if p_direction is null or p_direction not in ('credit', 'debit') or p_amount is null or p_amount <= 0
    or p_amount <> round(p_amount, 2) or length(trim(coalesce(p_reason, ''))) < 3
    or length(trim(p_reason)) > 500 then
    raise exception 'Enter a positive amount and a reason of 3 to 500 characters.';
  end if;

  select balance into member_balance
  from public.profiles
  where id = p_member_id and not is_banned
  for update;
  if not found then raise exception 'Active member not found.'; end if;

  signed_amount := case when p_direction = 'credit' then p_amount else -p_amount end;
  if member_balance + signed_amount < 0 then
    raise exception 'The debit exceeds the member wallet balance.';
  end if;
  update public.profiles set balance = balance + signed_amount where id = p_member_id;
  insert into public.transactions (user_id, kind, amount, status, note, admin_reason, approved_by, approved_at)
  values (
    p_member_id, 'adjustment', signed_amount, 'approved',
    'Administrator ' || p_direction, trim(p_reason), auth.uid(), now()
  );
end;
$$;

create or replace function public.admin_set_member_banned(
  p_member_id uuid,
  p_is_banned boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required.';
  end if;
  if p_member_id = auth.uid() and p_is_banned then
    raise exception 'You cannot ban your own administrator account.';
  end if;
  if p_is_banned is null then raise exception 'Choose whether to ban or restore this member.'; end if;
  if p_is_banned and length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Enter a reason of at least 3 characters to ban this member.';
  end if;
  update public.profiles
  set is_banned = p_is_banned,
      ban_reason = case when p_is_banned then trim(p_reason) else null end
  where id = p_member_id;
  if not found then raise exception 'Member not found.'; end if;
end;
$$;

create or replace function public.admin_set_withdrawal_method(p_transaction_id uuid, p_method text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required.';
  end if;
  if p_method is null or p_method not in ('manual', 'api') then raise exception 'Choose manual or API payout.'; end if;

  update public.transactions
  set payout_method = p_method
  where id = p_transaction_id and kind = 'withdraw' and status = 'pending';
  if not found then raise exception 'Pending withdrawal not found.'; end if;
end;
$$;

create or replace function public.admin_withdrawal_action(
  p_transaction_id uuid,
  p_action text,
  p_reason text default null,
  p_manual_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  withdrawal public.transactions%rowtype;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required.';
  end if;
  if p_action is null or p_action not in ('reject', 'approve_manual', 'manual_paid', 'manual_failed') then
    raise exception 'Unsupported withdrawal action.';
  end if;
  if p_action in ('reject', 'manual_failed')
    and length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason of at least 3 characters is required.';
  end if;

  select * into withdrawal
  from public.transactions
  where id = p_transaction_id and kind = 'withdraw'
  for update;
  if not found then raise exception 'Withdrawal not found.'; end if;

  if p_action = 'reject' then
    if withdrawal.status <> 'pending' then raise exception 'Only pending withdrawals can be rejected.'; end if;
    update public.profiles set balance = balance + withdrawal.amount where id = withdrawal.user_id;
    update public.transactions set status = 'rejected', admin_reason = trim(p_reason),
      failure_reason = trim(p_reason), approved_by = auth.uid(), approved_at = now(), settled_at = now(),
      note = 'Withdrawal rejected; reserved balance refunded'
    where id = p_transaction_id;
  elsif p_action = 'approve_manual' then
    if withdrawal.status <> 'pending' then raise exception 'Only pending withdrawals can be approved for manual payment.'; end if;
    update public.transactions set status = 'processing', payout_method = 'manual',
      approved_by = auth.uid(), approved_at = now(), admin_reason = null,
      note = 'Manually approved; awaiting payment confirmation'
    where id = p_transaction_id;
  elsif p_action = 'manual_paid' then
    if withdrawal.status <> 'processing' or withdrawal.payout_method <> 'manual' then
      raise exception 'Only a manually approved withdrawal can be marked paid.';
    end if;
    if length(trim(coalesce(p_manual_reference, ''))) < 1 then
      raise exception 'Enter the external payment reference before marking the payout paid.';
    end if;
    if length(trim(coalesce(p_manual_reference, ''))) > 200 then
      raise exception 'Payment reference must be 200 characters or fewer.';
    end if;
    update public.transactions set status = 'approved', manual_payment_reference = nullif(trim(p_manual_reference), ''),
      admin_reason = null, failure_reason = null, settled_at = now(), note = 'Manual withdrawal paid'
    where id = p_transaction_id;
  else
    if withdrawal.status <> 'processing' or withdrawal.payout_method <> 'manual' then
      raise exception 'Only a manually approved withdrawal can be marked failed.';
    end if;
    update public.profiles set balance = balance + withdrawal.amount where id = withdrawal.user_id;
    update public.transactions set status = 'rejected', admin_reason = trim(p_reason),
      failure_reason = trim(p_reason), settled_at = now(), note = 'Manual withdrawal failed; reserved balance refunded'
    where id = p_transaction_id;
  end if;
end;
$$;

create or replace function public.admin_review_deposit(
  p_transaction_id uuid,
  p_action text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  deposit public.transactions%rowtype;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required.';
  end if;
  if p_action is null or p_action not in ('approve', 'reject') then raise exception 'Choose approve or reject.'; end if;
  if p_action = 'reject' and length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A rejection reason of at least 3 characters is required.';
  end if;

  select * into deposit from public.transactions
  where id = p_transaction_id and kind = 'deposit' and status in ('pending', 'processing')
  for update;
  if not found then raise exception 'Pending deposit not found.'; end if;
  if deposit.provider_transaction_id is not null or deposit.payment_provider is not null then
    raise exception 'Provider-managed deposits are settled only by verified payment confirmation.';
  end if;

  if p_action = 'approve' then
    update public.profiles set balance = balance + deposit.amount where id = deposit.user_id;
    update public.transactions set status = 'approved', approved_by = auth.uid(), approved_at = now(),
      settled_at = now(), failure_reason = null, admin_reason = null, note = 'Deposit approved by administrator'
    where id = p_transaction_id;
  else
    update public.transactions set status = 'rejected', approved_by = auth.uid(), approved_at = now(),
      settled_at = now(), failure_reason = trim(p_reason), admin_reason = trim(p_reason),
      note = 'Deposit rejected by administrator'
    where id = p_transaction_id;
  end if;
end;
$$;

create or replace function public.admin_log_referral_share()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to record an invitation share.'; end if;
  insert into public.referral_share_events (user_id) values (auth.uid());
end;
$$;

create or replace function public.get_admin_dashboard_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  result jsonb;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required.';
  end if;

  select jsonb_build_object(
    'overview', (
      select jsonb_build_object(
        'total_members', (select count(*) from public.profiles),
        'joined_today', (select count(*) from public.profiles where (created_at at time zone 'Africa/Kampala')::date = (now() at time zone 'Africa/Kampala')::date),
        'joined_yesterday', (select count(*) from public.profiles where (created_at at time zone 'Africa/Kampala')::date = (now() at time zone 'Africa/Kampala')::date - 1),
        'deposits_pending', (select count(*) from public.transactions where kind = 'deposit' and status in ('pending', 'processing')),
        'withdrawals_pending', (select count(*) from public.transactions where kind = 'withdraw' and status in ('pending', 'processing')),
        'deposited', coalesce((select sum(amount) from public.transactions where kind = 'deposit' and status = 'approved'), 0),
        'withdrawn', coalesce((select sum(coalesce(net_amount, amount)) from public.transactions where kind = 'withdraw' and status = 'approved'), 0),
        'invested', coalesce((select sum(amount) from public.transactions where kind = 'invest' and status = 'approved'), 0),
        'returns_paid', coalesce((select sum(amount) from public.transactions where kind = 'income' and status = 'approved'), 0),
        'test_plan_volume', (select count(*) from public.investments),
        'referral_commission_paid', coalesce((select sum(amount) from public.transactions where kind = 'rebate' and status = 'approved'), 0),
        'member_wallet_balance', coalesce((select sum(balance) from public.profiles), 0),
        'active_test_plans', (select count(*) from public.investments where status = 'active'),
        'net_revenue_collected',
          coalesce((select sum(amount) from public.transactions where kind = 'deposit' and status = 'approved'), 0)
          - coalesce((select sum(coalesce(net_amount, amount)) from public.transactions where kind = 'withdraw' and status = 'approved'), 0)
          - coalesce((select sum(amount) from public.transactions where kind = 'income' and status = 'approved'), 0)
          - coalesce((select sum(amount) from public.transactions where kind = 'rebate' and status = 'approved'), 0),
        'referral_links_sent', (select count(*) from public.referral_share_events)
      )
    ),
    'transactions', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at desc)
      from (
        select tx.id, tx.user_id, tx.kind, tx.amount, tx.fee, tx.net_amount, tx.status,
          tx.note, tx.payment_phone, tx.payment_provider, tx.payment_reference,
          tx.provider_transaction_id, tx.failure_reason, tx.admin_reason,
          tx.payout_method, tx.manual_payment_reference, tx.approved_by, tx.approved_at,
          tx.created_at, profile.phone as member_phone, approver.phone as approved_by_phone
        from public.transactions tx
        join public.profiles profile on profile.id = tx.user_id
        left join public.profiles approver on approver.id = tx.approved_by
        where tx.kind in ('deposit', 'withdraw')
        order by tx.created_at desc
        limit 2000
      ) t
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at desc)
      from (
        select p.id, p.phone, p.referral_code, p.balance, p.created_at,
          p.is_banned, p.ban_reason, u.email,
          coalesce(sum(tx.amount) filter (where tx.kind = 'deposit' and tx.status = 'approved'), 0) as deposited,
          coalesce(sum(coalesce(tx.net_amount, tx.amount)) filter (where tx.kind = 'withdraw' and tx.status = 'approved'), 0) as withdrawn,
          coalesce(sum(tx.amount) filter (where tx.kind = 'invest' and tx.status = 'approved'), 0) as invested,
          coalesce(sum(tx.amount) filter (where tx.kind = 'adjustment' and tx.status = 'approved' and tx.amount > 0), 0) as credited,
          coalesce(abs(sum(tx.amount) filter (where tx.kind = 'adjustment' and tx.status = 'approved' and tx.amount < 0)), 0) as deducted,
          coalesce(u.raw_app_meta_data ->> 'role' = 'admin', false) as is_admin
        from public.profiles p
        join auth.users u on u.id = p.id
        left join public.transactions tx on tx.user_id = p.id
        group by p.id, u.id, u.email, u.raw_app_meta_data
        order by p.created_at desc
        limit 2000
      ) m
    ), '[]'::jsonb),
    'referrals', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from (
        select referred.id, referred.phone, referred.referral_code, referred.created_at,
          referrer.id as referrer_id, referrer.phone as referrer_phone,
          referrer.referral_code as referrer_code,
          coalesce(investment_totals.invested, 0) as invested,
          coalesce(reward_totals.commission_paid, 0) as commission_paid
        from public.profiles referred
        join public.profiles referrer on referrer.id = referred.referred_by
        left join lateral (
          select sum(amount) as invested from public.investments where user_id = referred.id
        ) investment_totals on true
        left join lateral (
          select sum(amount) as commission_paid from public.transactions
          where user_id = referrer.id and related_user_id = referred.id and kind = 'rebate' and status = 'approved'
        ) reward_totals on true
        order by referred.created_at desc
        limit 2000
      ) r
    ), '[]'::jsonb),
    'active_tests', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.ends_at asc)
      from (
        select i.id, i.user_id, p.phone, i.product_id, pr.name as plan_name, i.amount,
          i.daily_income, i.duration_days, i.claimed_days, i.started_at, i.ends_at,
          i.test_status,
          greatest(0, least(i.duration_days, floor(extract(epoch from (now() - i.started_at)) / 86400)::integer)) as elapsed_days
        from public.investments i
        join public.profiles p on p.id = i.user_id
        join public.products pr on pr.id = i.product_id
        where i.status = 'active'
        order by i.ends_at asc
        limit 2000
      ) a
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(to_jsonb(pr) order by pr.price asc)
      from public.products pr
    ), '[]'::jsonb),
    'admins', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'phone', p.phone, 'email', u.email, 'created_at', p.created_at) order by p.created_at asc)
      from public.profiles p
      join auth.users u on u.id = p.id
      where u.raw_app_meta_data ->> 'role' = 'admin'
    ), '[]'::jsonb),
    'settings', public.get_public_app_settings(),
    'community', coalesce((
      select jsonb_build_object('service_chat_url', service_chat_url, 'telegram_group_url', telegram_group_url)
      from public.community_settings where id = 1
    ), jsonb_build_object('service_chat_url', '', 'telegram_group_url', ''))
  ) into result;
  return result;
end;
$$;

create or replace function public.admin_review_test_completion(
  p_investment_id uuid,
  p_approve boolean
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_investment public.investments%rowtype;
  referrer_id uuid;
  reward numeric(14, 2) := 0;
  reward_percent numeric(5, 2);
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required.';
  end if;
  if p_approve is null then raise exception 'Choose whether to approve this test completion.'; end if;
  select * into chosen_investment from public.investments
  where id = p_investment_id and test_status = 'pending' for update;
  if not found then raise exception 'Pending test completion not found.'; end if;
  update public.investments set test_status = case when p_approve then 'approved' else 'rejected' end
  where id = chosen_investment.id;
  if p_approve and not chosen_investment.referral_bonus_paid then
    select referred_by into referrer_id from public.profiles where id = chosen_investment.user_id;
    if referrer_id is not null then
      select referral_reward_percent into reward_percent from public.app_settings where id = 1;
      reward := round(chosen_investment.amount * coalesce(reward_percent, 15) / 100, 2);
      update public.profiles set balance = balance + reward where id = referrer_id;
      insert into public.transactions (user_id, related_user_id, kind, amount, status, note)
      values (referrer_id, chosen_investment.user_id, 'rebate', reward, 'approved', coalesce(reward_percent, 15) || '% referral reward for a verified test');
      update public.investments set referral_bonus_paid = true where id = chosen_investment.id;
    end if;
  end if;
  return reward;
end;
$$;

create or replace function public.request_mobile_deposit(
  p_amount numeric,
  p_phone_number text,
  p_provider text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_row public.transactions%rowtype;
  new_transaction_id uuid := gen_random_uuid();
  new_reference text;
  minimum_amount numeric(14, 2);
begin
  if auth.uid() is null then raise exception 'Sign in to start a deposit.'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_banned) then
    raise exception 'This account is restricted. Contact support.';
  end if;
  select minimum_deposit into minimum_amount from public.app_settings where id = 1;
  if p_amount is null or p_amount < coalesce(minimum_amount, 10000) or p_amount <> trunc(p_amount) then
    raise exception 'The minimum deposit is UGX %.', coalesce(minimum_amount, 10000);
  end if;
  if p_phone_number is null or p_phone_number !~ '^\+256[0-9]{9}$' then raise exception 'Enter a valid Uganda mobile number.'; end if;
  if lower(coalesce(p_provider, '')) not in ('mtn', 'airtel') then raise exception 'Choose MTN or Airtel Mobile Money.'; end if;

  select * into existing_row from public.transactions
  where user_id = auth.uid() and kind = 'deposit' and amount = p_amount
    and payment_phone = p_phone_number and status in ('pending', 'processing')
  order by created_at desc limit 1 for update;
  if found then
    return jsonb_build_object(
      'transaction_id', existing_row.id, 'reference', existing_row.payment_reference,
      'phone_number', existing_row.payment_phone, 'provider', existing_row.payment_provider,
      'amount', existing_row.amount
    );
  end if;

  new_reference := 'TL-D-' || replace(new_transaction_id::text, '-', '');
  insert into public.transactions (
    id, user_id, kind, amount, net_amount, status, note,
    payment_phone, payment_provider, payment_reference
  ) values (
    new_transaction_id, auth.uid(), 'deposit', p_amount, p_amount, 'pending',
    'Deposit prompt requested', p_phone_number, lower(p_provider), new_reference
  );
  return jsonb_build_object(
    'transaction_id', new_transaction_id, 'reference', new_reference,
    'phone_number', p_phone_number, 'provider', lower(p_provider), 'amount', p_amount
  );
end;
$$;

create or replace function public.request_mobile_withdrawal(
  p_amount numeric,
  p_phone_number text,
  p_provider text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(14, 2);
  existing_row public.transactions%rowtype;
  withdrawal_fee numeric(14, 2);
  payout_amount numeric(14, 2);
  minimum_amount numeric(14, 2);
  fee_percent numeric(5, 2);
  configured_start time;
  configured_end time;
  kampala_time time;
  new_transaction_id uuid := gen_random_uuid();
  new_reference text;
begin
  if auth.uid() is null then raise exception 'Sign in to request a withdrawal.'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_banned) then
    raise exception 'This account is restricted. Contact support.';
  end if;
  select minimum_withdrawal, withdrawal_fee_percent, app_settings.withdrawal_start, app_settings.withdrawal_end
  into minimum_amount, fee_percent, configured_start, configured_end
  from public.app_settings where id = 1;
  if p_amount is null or p_amount < coalesce(minimum_amount, 5000) or p_amount <> trunc(p_amount) then
    raise exception 'The minimum withdrawal is UGX %.', coalesce(minimum_amount, 5000);
  end if;
  if p_phone_number is null or p_phone_number !~ '^\+256[0-9]{9}$' then raise exception 'Enter a valid Uganda mobile number.'; end if;
  if lower(coalesce(p_provider, '')) not in ('mtn', 'airtel') then raise exception 'Choose MTN or Airtel Mobile Money.'; end if;
  kampala_time := (now() at time zone 'Africa/Kampala')::time;
  if configured_start < configured_end then
    if kampala_time < configured_start or kampala_time >= configured_end then
      raise exception 'Withdrawals are available from % to % Kampala time.', configured_start, configured_end;
    end if;
  elsif kampala_time < configured_start and kampala_time >= configured_end then
    raise exception 'Withdrawals are currently outside the configured service hours.';
  end if;

  select balance into current_balance from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Member profile not found.'; end if;
  select * into existing_row from public.transactions
  where user_id = auth.uid() and kind = 'withdraw' and amount = p_amount
    and payment_phone = p_phone_number and status in ('pending', 'processing')
  order by created_at desc limit 1 for update;
  if found then
    return jsonb_build_object(
      'transaction_id', existing_row.id, 'reference', existing_row.payment_reference,
      'phone_number', existing_row.payment_phone, 'provider', existing_row.payment_provider,
      'amount', existing_row.net_amount, 'gross_amount', existing_row.amount, 'fee', existing_row.fee
    );
  end if;
  if current_balance < p_amount then raise exception 'Insufficient balance.'; end if;

  withdrawal_fee := round(p_amount * coalesce(fee_percent, 20) / 100, 2);
  payout_amount := p_amount - withdrawal_fee;
  new_reference := 'TL-W-' || replace(new_transaction_id::text, '-', '');
  update public.profiles set balance = balance - p_amount where id = auth.uid();
  insert into public.transactions (
    id, user_id, kind, amount, fee, net_amount, status, note,
    payment_phone, payment_provider, payment_reference
  ) values (
    new_transaction_id, auth.uid(), 'withdraw', p_amount, withdrawal_fee,
    payout_amount, 'pending', 'Withdrawal request pending admin approval',
    p_phone_number, lower(p_provider), new_reference
  );
  return jsonb_build_object(
    'transaction_id', new_transaction_id, 'reference', new_reference,
    'phone_number', p_phone_number, 'provider', lower(p_provider),
    'amount', payout_amount, 'gross_amount', p_amount, 'fee', withdrawal_fee
  );
end;
$$;

revoke all on function public.get_public_app_settings() from public;
revoke all on function public.admin_save_app_settings(numeric, numeric, time, time, numeric, numeric, text, text, text, text) from public, anon;
revoke all on function public.admin_update_product(uuid, text, numeric, numeric, integer, boolean) from public, anon;
revoke all on function public.admin_adjust_member_balance(uuid, text, numeric, text) from public, anon;
revoke all on function public.admin_set_member_banned(uuid, boolean, text) from public, anon;
revoke all on function public.admin_set_withdrawal_method(uuid, text) from public, anon;
revoke all on function public.admin_withdrawal_action(uuid, text, text, text) from public, anon;
revoke all on function public.admin_review_deposit(uuid, text, text) from public, anon;
revoke all on function public.admin_log_referral_share() from public, anon;
revoke all on function public.get_admin_dashboard_data() from public, anon;
revoke all on function public.admin_review_test_completion(uuid, boolean) from public, anon;
grant execute on function public.get_public_app_settings() to anon, authenticated;
grant execute on function public.admin_save_app_settings(numeric, numeric, time, time, numeric, numeric, text, text, text, text) to authenticated;
grant execute on function public.admin_update_product(uuid, text, numeric, numeric, integer, boolean) to authenticated;
grant execute on function public.admin_adjust_member_balance(uuid, text, numeric, text) to authenticated;
grant execute on function public.admin_set_member_banned(uuid, boolean, text) to authenticated;
grant execute on function public.admin_set_withdrawal_method(uuid, text) to authenticated;
grant execute on function public.admin_withdrawal_action(uuid, text, text, text) to authenticated;
grant execute on function public.admin_review_deposit(uuid, text, text) to authenticated;
grant execute on function public.admin_log_referral_share() to authenticated;
grant execute on function public.get_admin_dashboard_data() to authenticated;
grant execute on function public.admin_review_test_completion(uuid, boolean) to authenticated;

create or replace function public.invest_in_product(product_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(14, 2);
  chosen_product public.products%rowtype;
  purchase_count integer;
  new_investment_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to buy a test plan.'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_banned) then
    raise exception 'This account is restricted. Contact support.';
  end if;

  select balance into current_balance from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Member profile not found.'; end if;
  select * into chosen_product from public.products where id = $1 and active = true;
  if not found then raise exception 'This test plan is not available.'; end if;

  select count(*) into purchase_count from public.investments
  where user_id = auth.uid() and investments.product_id = $1;
  if purchase_count >= 3 then raise exception 'Each test plan can be purchased a maximum of 3 times.'; end if;
  if current_balance < chosen_product.price then raise exception 'Your balance is too low for this test plan.'; end if;

  update public.profiles set balance = balance - chosen_product.price where id = auth.uid();
  insert into public.investments (
    user_id, product_id, amount, daily_income, duration_days, status, started_at, ends_at
  ) values (
    auth.uid(), chosen_product.id, chosen_product.price, chosen_product.daily_income,
    chosen_product.duration_days, 'active', now(), now() + make_interval(days => chosen_product.duration_days)
  ) returning id into new_investment_id;
  insert into public.transactions (user_id, kind, amount, status, note)
  values (auth.uid(), 'invest', chosen_product.price, 'approved', chosen_product.name || ' purchased');
  return new_investment_id;
end;
$$;

create or replace function public.submit_test_completion(investment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_investment public.investments%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to submit a completed test.'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_banned) then
    raise exception 'This account is restricted. Contact support.';
  end if;

  select * into chosen_investment from public.investments
  where id = investment_id and user_id = auth.uid() for update;
  if not found then raise exception 'Test plan not found.'; end if;
  if chosen_investment.status <> 'active' then raise exception 'This test plan is no longer active.'; end if;
  if chosen_investment.test_status in ('pending', 'approved') then
    raise exception 'This test completion has already been submitted.';
  end if;
  update public.investments set test_status = 'pending', test_completed_at = now()
  where id = chosen_investment.id;
end;
$$;

create or replace function public.claim_daily_income(investment_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_investment public.investments%rowtype;
  elapsed_days integer;
  days_to_claim integer;
  payout numeric(14, 2);
begin
  if auth.uid() is null then raise exception 'Sign in to claim daily earnings.'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_banned) then
    raise exception 'This account is restricted. Contact support.';
  end if;

  select * into chosen_investment from public.investments
  where id = investment_id and user_id = auth.uid() for update;
  if not found then raise exception 'Test plan not found.'; end if;
  if chosen_investment.status <> 'active' then raise exception 'This test plan has completed its earning period.'; end if;

  elapsed_days := floor(extract(epoch from (now() - chosen_investment.started_at)) / 86400)::integer;
  days_to_claim := least(
    chosen_investment.duration_days - chosen_investment.claimed_days,
    elapsed_days - chosen_investment.claimed_days
  );
  if days_to_claim < 1 then raise exception 'Daily earnings become available after each 24-hour period.'; end if;

  payout := chosen_investment.daily_income * days_to_claim;
  update public.investments
  set claimed_days = claimed_days + days_to_claim,
      status = case when claimed_days + days_to_claim >= duration_days then 'completed' else 'active' end
  where id = chosen_investment.id;
  update public.profiles set balance = balance + payout where id = auth.uid();
  insert into public.transactions (user_id, kind, amount, status, note)
  values (auth.uid(), 'income', payout, 'approved', days_to_claim || ' day(s) of test plan earnings');
  return payout;
end;
$$;

create or replace function public.begin_pesajet_withdrawal(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payout_row public.transactions%rowtype;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Only an administrator can approve payouts.';
  end if;

  select * into payout_row
  from public.transactions
  where id = p_transaction_id and kind = 'withdraw'
  for update;
  if not found then raise exception 'Withdrawal request not found.'; end if;
  if payout_row.status not in ('pending', 'processing') then
    raise exception 'This withdrawal is no longer awaiting payout.';
  end if;
  if payout_row.payout_method <> 'api' then
    raise exception 'This withdrawal is assigned to manual payout.';
  end if;

  if payout_row.status = 'pending' then
    update public.transactions
    set status = 'processing', approved_by = auth.uid(), approved_at = now(),
        note = 'Admin approved; API payout processing'
    where id = payout_row.id;
  end if;
  return jsonb_build_object(
    'transaction_id', payout_row.id,
    'reference', payout_row.payment_reference,
    'phone_number', payout_row.payment_phone,
    'provider', payout_row.payment_provider,
    'amount', payout_row.net_amount
  );
end;
$$;

create or replace function public.review_test_completion(investment_id uuid, approve boolean)
returns numeric
language sql
security definer
set search_path = public
as $$
  select public.admin_review_test_completion($1, $2);
$$;
