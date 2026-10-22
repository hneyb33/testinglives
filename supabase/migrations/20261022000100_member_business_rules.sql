create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text not null unique,
  referral_code text not null unique,
  referred_by uuid references public.profiles(id) on delete set null,
  balance numeric(14, 2) not null default 0 check (balance >= 0),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists referral_code text;
alter table public.profiles add column if not exists referred_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists balance numeric(14, 2) not null default 0;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
update public.profiles
set referral_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
where referral_code is null or trim(referral_code) = '';
update public.profiles set referral_code = lower(trim(referral_code));
alter table public.profiles alter column referral_code set not null;
create unique index if not exists profiles_referral_code_unique on public.profiles (referral_code);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image text not null,
  price numeric(14, 2) not null check (price > 0),
  daily_income numeric(14, 2) not null check (daily_income > 0),
  duration_days integer not null check (duration_days > 0),
  active boolean not null default true
);

alter table public.products add column if not exists image text;
alter table public.products add column if not exists daily_income numeric(14, 2);
alter table public.products add column if not exists duration_days integer not null default 1;
alter table public.products add column if not exists active boolean not null default true;

create table if not exists public.investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id),
  amount numeric(14, 2) not null,
  daily_income numeric(14, 2) not null,
  duration_days integer not null,
  claimed_days integer not null default 0,
  status text not null default 'active' check (status in ('active', 'completed')),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null
);

alter table public.investments add column if not exists duration_days integer not null default 1;
alter table public.investments add column if not exists claimed_days integer not null default 0;
alter table public.investments add column if not exists test_status text not null default 'not_started' check (test_status in ('not_started', 'pending', 'approved', 'rejected'));
alter table public.investments add column if not exists test_completed_at timestamptz;
alter table public.investments add column if not exists referral_bonus_paid boolean not null default false;
create index if not exists investments_user_product_idx on public.investments (user_id, product_id);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('deposit', 'withdraw', 'invest', 'income', 'rebate')),
  amount numeric(14, 2) not null,
  fee numeric(14, 2) not null default 0,
  net_amount numeric(14, 2),
  bank_account_id uuid,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text,
  created_at timestamptz not null default now()
);

alter table public.transactions add column if not exists fee numeric(14, 2) not null default 0;
alter table public.transactions add column if not exists net_amount numeric(14, 2);
alter table public.transactions add column if not exists bank_account_id uuid;
create index if not exists transactions_user_created_idx on public.transactions (user_id, created_at desc);

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bank_name text not null,
  account_name text not null,
  account_number text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_bank_account_id_fkey'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_bank_account_id_fkey
      foreign key (bank_account_id) references public.bank_accounts(id) on delete set null;
  end if;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_code text := lower(trim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')));
  referrer_id uuid;
  new_code text;
begin
  perform pg_advisory_xact_lock(74211906);

  if invite_code <> '' then
    select id into referrer_id
    from public.profiles
    where referral_code = invite_code;

    if referrer_id is null then
      raise exception 'Invitation code is invalid.';
    end if;
  elsif exists (select 1 from public.profiles) then
    raise exception 'An invitation code is required.';
  end if;

  loop
    new_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    exit when not exists (select 1 from public.profiles where referral_code = new_code);
  end loop;

  insert into public.profiles (id, phone, referral_code, referred_by)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'phone', ''), new.phone, new.email),
    new_code,
    referrer_id
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.registration_requires_referral_code()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles);
$$;

create or replace function public.referral_code_exists(code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where referral_code = lower(trim($1))
  );
$$;

create or replace function public.request_deposit(amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_transaction_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to request a deposit.';
  end if;
  if amount is null or amount < 10000 or amount <> trunc(amount) then
    raise exception 'The minimum deposit is UGX 10,000.';
  end if;

  insert into public.transactions (user_id, kind, amount, status, note)
  values (auth.uid(), 'deposit', amount, 'pending', 'Deposit request awaiting review')
  returning id into new_transaction_id;

  return new_transaction_id;
end;
$$;

create or replace function public.add_bank_account(bank_name text, account_name text, account_number text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to add a payout account.';
  end if;
  if trim(coalesce(bank_name, '')) = '' or trim(coalesce(account_name, '')) = '' or trim(coalesce(account_number, '')) = '' then
    raise exception 'Complete all payout account details.';
  end if;

  insert into public.bank_accounts (user_id, bank_name, account_name, account_number)
  values (auth.uid(), trim(bank_name), trim(account_name), trim(account_number))
  returning id into new_account_id;

  return new_account_id;
end;
$$;

create or replace function public.request_withdrawal(amount numeric, bank_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(14, 2);
  withdrawal_fee numeric(14, 2);
  payout numeric(14, 2);
  local_time time;
  new_transaction_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to request a withdrawal.';
  end if;
  if amount is null or amount < 5000 or amount <> trunc(amount) then
    raise exception 'The minimum withdrawal is UGX 5,000.';
  end if;

  local_time := (now() at time zone 'Africa/Kampala')::time;
  if local_time < time '09:00' or local_time >= time '21:00' then
    raise exception 'Withdrawals are available from 9:00 AM to 9:00 PM Kampala time.';
  end if;

  if not exists (
    select 1 from public.bank_accounts
    where id = bank_account_id and user_id = auth.uid()
  ) then
    raise exception 'Choose a valid payout account.';
  end if;

  select balance into current_balance
  from public.profiles
  where id = auth.uid()
  for update;

  if not found then
    raise exception 'Member profile not found.';
  end if;

  if current_balance < amount then
    raise exception 'Insufficient balance.';
  end if;

  withdrawal_fee := round(amount * 0.20, 2);
  payout := amount - withdrawal_fee;

  update public.profiles set balance = balance - amount where id = auth.uid();
  insert into public.transactions (user_id, kind, amount, fee, net_amount, bank_account_id, status, note)
  values (auth.uid(), 'withdraw', amount, withdrawal_fee, payout, bank_account_id, 'pending', 'Withdrawal request awaiting review')
  returning id into new_transaction_id;

  return new_transaction_id;
end;
$$;

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
  if auth.uid() is null then
    raise exception 'Sign in to buy a test plan.';
  end if;

  select balance into current_balance
  from public.profiles
  where id = auth.uid()
  for update;

  if not found then
    raise exception 'Member profile not found.';
  end if;

  select * into chosen_product
  from public.products
  where id = $1 and active = true;

  if not found then
    raise exception 'This test plan is not available.';
  end if;

  select count(*) into purchase_count
  from public.investments
  where user_id = auth.uid() and investments.product_id = $1;

  if purchase_count >= 3 then
    raise exception 'Each test plan can be purchased a maximum of 3 times.';
  end if;
  if current_balance < chosen_product.price then
    raise exception 'Your balance is too low for this test plan.';
  end if;

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
  if auth.uid() is null then
    raise exception 'Sign in to submit a completed test.';
  end if;

  select * into chosen_investment
  from public.investments
  where id = investment_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Test plan not found.';
  end if;
  if chosen_investment.status <> 'active' then
    raise exception 'This test plan is no longer active.';
  end if;
  if chosen_investment.test_status = 'pending' or chosen_investment.test_status = 'approved' then
    raise exception 'This test completion has already been submitted.';
  end if;

  update public.investments
  set test_status = 'pending', test_completed_at = now()
  where id = chosen_investment.id;
end;
$$;

create or replace function public.review_test_completion(investment_id uuid, approve boolean)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_investment public.investments%rowtype;
  referrer_id uuid;
  referral_bonus numeric(14, 2) := 0;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Only an administrator can review test completions.';
  end if;

  select * into chosen_investment
  from public.investments
  where id = investment_id and test_status = 'pending'
  for update;

  if not found then
    raise exception 'Pending test completion not found.';
  end if;

  update public.investments
  set test_status = case when approve then 'approved' else 'rejected' end
  where id = chosen_investment.id;

  if approve and not chosen_investment.referral_bonus_paid then
    select referred_by into referrer_id
    from public.profiles
    where id = chosen_investment.user_id;

    if referrer_id is not null then
      referral_bonus := round(chosen_investment.amount * 0.15, 2);
      update public.profiles set balance = balance + referral_bonus where id = referrer_id;
      insert into public.transactions (user_id, kind, amount, status, note)
      values (referrer_id, 'rebate', referral_bonus, 'approved', '15% referral reward for a verified test');
      update public.investments set referral_bonus_paid = true where id = chosen_investment.id;
    end if;
  end if;

  return referral_bonus;
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
  if auth.uid() is null then
    raise exception 'Sign in to claim daily earnings.';
  end if;

  select * into chosen_investment
  from public.investments
  where id = investment_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Test plan not found.';
  end if;
  if chosen_investment.status <> 'active' then
    raise exception 'This test plan has completed its earning period.';
  end if;

  elapsed_days := floor(extract(epoch from (now() - chosen_investment.started_at)) / 86400)::integer;
  days_to_claim := least(
    chosen_investment.duration_days - chosen_investment.claimed_days,
    elapsed_days - chosen_investment.claimed_days
  );
  if days_to_claim < 1 then
    raise exception 'Daily earnings become available after each 24-hour period.';
  end if;

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

create or replace function public.review_money_request(transaction_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.transactions%rowtype;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Only an administrator can review money requests.';
  end if;

  select * into request_row
  from public.transactions
  where id = transaction_id and kind in ('deposit', 'withdraw') and status = 'pending'
  for update;

  if not found then
    raise exception 'Pending money request not found.';
  end if;

  update public.transactions
  set status = case when approve then 'approved' else 'rejected' end
  where id = request_row.id;

  if request_row.kind = 'deposit' and approve then
    update public.profiles set balance = balance + request_row.amount where id = request_row.user_id;
  elsif request_row.kind = 'withdraw' and not approve then
    update public.profiles set balance = balance + request_row.amount where id = request_row.user_id;
  end if;
end;
$$;

create or replace function public.my_team()
returns table(id uuid, phone text, created_at timestamptz, level integer, invested numeric)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         case when length(p.phone) > 6 then left(p.phone, 4) || '****' || right(p.phone, 3) else p.phone end,
         p.created_at, 1,
         coalesce(sum(i.amount), 0)::numeric
  from public.profiles p
  left join public.investments i on i.user_id = p.id
  where p.referred_by = auth.uid()
  group by p.id, p.phone, p.created_at
  order by p.created_at desc;
$$;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.investments enable row level security;
alter table public.transactions enable row level security;
alter table public.bank_accounts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_own') then
    create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'products' and policyname = 'products_select_active') then
    create policy products_select_active on public.products for select to anon, authenticated using (active = true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'investments' and policyname = 'investments_select_own') then
    create policy investments_select_own on public.investments for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transactions' and policyname = 'transactions_select_own') then
    create policy transactions_select_own on public.transactions for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bank_accounts' and policyname = 'bank_accounts_select_own') then
    create policy bank_accounts_select_own on public.bank_accounts for select to authenticated using (user_id = (select auth.uid()));
  end if;
end;
$$;

grant select on public.profiles, public.investments, public.transactions, public.bank_accounts to authenticated;
grant select on public.products to anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.registration_requires_referral_code() from public, anon, authenticated;
revoke all on function public.referral_code_exists(text) from public, anon, authenticated;
revoke all on function public.request_deposit(numeric) from public, anon, authenticated;
revoke all on function public.add_bank_account(text, text, text) from public, anon, authenticated;
revoke all on function public.request_withdrawal(numeric, uuid) from public, anon, authenticated;
revoke all on function public.invest_in_product(uuid) from public, anon, authenticated;
revoke all on function public.submit_test_completion(uuid) from public, anon, authenticated;
revoke all on function public.claim_daily_income(uuid) from public, anon, authenticated;
revoke all on function public.review_money_request(uuid, boolean) from public, anon, authenticated;
revoke all on function public.review_test_completion(uuid, boolean) from public, anon, authenticated;
revoke all on function public.my_team() from public, anon, authenticated;
grant execute on function public.registration_requires_referral_code() to anon, authenticated;
grant execute on function public.referral_code_exists(text) to anon, authenticated;
grant execute on function public.request_deposit(numeric) to authenticated;
grant execute on function public.add_bank_account(text, text, text) to authenticated;
grant execute on function public.request_withdrawal(numeric, uuid) to authenticated;
grant execute on function public.invest_in_product(uuid) to authenticated;
grant execute on function public.submit_test_completion(uuid) to authenticated;
grant execute on function public.claim_daily_income(uuid) to authenticated;
grant execute on function public.review_money_request(uuid, boolean) to authenticated;
grant execute on function public.review_test_completion(uuid, boolean) to authenticated;
grant execute on function public.my_team() to authenticated;

revoke insert, update, delete on public.profiles, public.products, public.investments, public.transactions, public.bank_accounts from anon, authenticated;

update public.products set active = false;

insert into public.products (id, name, image, price, daily_income, duration_days, active)
values
  ('00000000-0000-4000-8000-000000000001', 'VIP Test 1', '/images/plan1.jpg', 10000, 2070, 35, true),
  ('00000000-0000-4000-8000-000000000002', 'VIP Test 2', '/images/plan2.jpg', 30000, 6800, 35, true),
  ('00000000-0000-4000-8000-000000000003', 'VIP Test 3', '/images/plan3.jpg', 50000, 10380, 40, true),
  ('00000000-0000-4000-8000-000000000004', 'VIP Test 4', '/images/plan4.jpg', 90000, 20500, 45, true),
  ('00000000-0000-4000-8000-000000000005', 'VIP Test 5', '/images/plan1.jpg', 180000, 40000, 50, true),
  ('00000000-0000-4000-8000-000000000006', 'VIP Test 6', '/images/plan2.jpg', 200000, 45000, 55, true),
  ('00000000-0000-4000-8000-000000000007', 'VIP Test 7', '/images/plan3.jpg', 400000, 82000, 70, true),
  ('00000000-0000-4000-8000-000000000008', 'VIP Test 8', '/images/plan4.jpg', 800000, 163000, 70, true),
  ('00000000-0000-4000-8000-000000000009', 'VIP Test 9', '/images/plan1.jpg', 1000000, 250000, 80, true)
on conflict (id) do update set
  name = excluded.name,
  image = excluded.image,
  price = excluded.price,
  daily_income = excluded.daily_income,
  duration_days = excluded.duration_days,
  active = excluded.active;