create table if not exists public.referral_commission_claims (
  deposit_transaction_id uuid primary key references public.transactions(id) on delete cascade,
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referee_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(14, 2) not null check (amount >= 0),
  claimed_at timestamptz not null default now()
);

alter table public.referral_commission_claims enable row level security;
revoke all on table public.referral_commission_claims from public, anon, authenticated, service_role;

create or replace function public.credit_deposit_referral_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  referrer_id uuid;
  reward_percent numeric(5, 2);
  commission numeric(14, 2);
  claimed_deposit_id uuid;
begin
  if new.kind <> 'deposit' or new.status <> 'approved' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'approved' then
    return new;
  end if;

  select referred_by into referrer_id
  from public.profiles
  where id = new.user_id;

  if referrer_id is null or referrer_id = new.user_id then
    return new;
  end if;

  select referral_reward_percent into reward_percent
  from public.app_settings
  where id = 1;

  commission := round(new.amount * coalesce(reward_percent, 15) / 100, 2);
  if commission <= 0 then
    return new;
  end if;

  insert into public.referral_commission_claims (
    deposit_transaction_id, referrer_id, referee_id, amount
  ) values (
    new.id, referrer_id, new.user_id, commission
  )
  on conflict (deposit_transaction_id) do nothing
  returning deposit_transaction_id into claimed_deposit_id;

  if claimed_deposit_id is null then
    return new;
  end if;

  update public.profiles set balance = balance + commission where id = referrer_id;
  if not found then
    raise exception 'Referral commission could not be credited because the referrer profile was not found.';
  end if;

  insert into public.transactions (
    user_id, related_user_id, kind, amount, status, note
  ) values (
    referrer_id, new.user_id, 'rebate', commission, 'approved',
    coalesce(reward_percent, 15) || '% referral commission for a successful deposit'
  );

  return new;
end;
$$;

revoke all on function public.credit_deposit_referral_commission() from public, anon, authenticated, service_role;

drop trigger if exists credit_deposit_referral_commission_on_approval on public.transactions;
create trigger credit_deposit_referral_commission_on_approval
after insert or update of status on public.transactions
for each row
execute function public.credit_deposit_referral_commission();

-- Pay commission for deposits approved before this migration was applied.
with eligible as (
  select
    deposit.id as deposit_id,
    deposit.user_id as referee_id,
    referee.referred_by as referrer_id,
    round(deposit.amount * coalesce(settings.referral_reward_percent, 15) / 100, 2) as commission
  from public.transactions deposit
  join public.profiles referee on referee.id = deposit.user_id
  left join public.app_settings settings on settings.id = 1
  where deposit.kind = 'deposit'
    and deposit.status = 'approved'
    and referee.referred_by is not null
    and referee.referred_by <> deposit.user_id
), claims as (
  insert into public.referral_commission_claims (
    deposit_transaction_id, referrer_id, referee_id, amount
  )
  select deposit_id, referrer_id, referee_id, commission
  from eligible
  where commission > 0
  on conflict (deposit_transaction_id) do nothing
  returning deposit_transaction_id, referrer_id, referee_id, amount
), totals as (
  select referrer_id, sum(amount) as amount
  from claims
  group by referrer_id
), credited as (
  update public.profiles profile
  set balance = profile.balance + totals.amount
  from totals
  where profile.id = totals.referrer_id
  returning profile.id
)
insert into public.transactions (user_id, related_user_id, kind, amount, status, note)
select referrer_id, referee_id, 'rebate', amount, 'approved', 'Referral commission for a successful deposit'
from claims;

-- Referral commission is now paid on deposits only; test review no longer pays a reward.
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
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required.';
  end if;
  if p_approve is null then raise exception 'Choose whether to approve this test completion.'; end if;

  select * into chosen_investment
  from public.investments
  where id = p_investment_id and test_status = 'pending'
  for update;

  if not found then raise exception 'Pending test completion not found.'; end if;

  update public.investments
  set test_status = case when p_approve then 'approved' else 'rejected' end
  where id = chosen_investment.id;

  return 0;
end;
$$;

alter table public.app_settings
  alter column referral_rule set default 'Commission is credited on each successful deposit and never depends on HIV status or test results.';

update public.app_settings
set referral_rule = 'Commission is credited on each successful deposit and never depends on HIV status or test results.'
where id = 1
  and referral_rule = 'Reward is paid after a referred member reports a completed test and it is verified. Rewards never depend on HIV status or test results.';
