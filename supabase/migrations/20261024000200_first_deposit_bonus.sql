create table if not exists public.deposit_bonus_claims (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  transaction_id uuid not null unique references public.transactions(id),
  claimed_at timestamptz not null default now()
);

alter table public.deposit_bonus_claims enable row level security;
revoke all on table public.deposit_bonus_claims from public, anon, authenticated, service_role;

insert into public.deposit_bonus_claims (user_id, transaction_id)
select distinct on (user_id) user_id, id
from public.transactions
where kind = 'deposit' and status = 'approved'
order by user_id, coalesce(settled_at, created_at), created_at, id
on conflict (user_id) do nothing;

create or replace function public.credit_deposit_bonus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_user_id uuid;
begin
  if new.kind <> 'deposit' or new.status <> 'approved' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'approved' then
      return new;
    end if;
  end if;

  insert into public.deposit_bonus_claims (user_id, transaction_id)
  values (new.user_id, new.id)
  on conflict (user_id) do nothing
  returning user_id into claimed_user_id;

  if claimed_user_id is null then
    return new;
  end if;

  update public.profiles
  set balance = balance + 1000
  where id = new.user_id;

  if not found then
    raise exception 'Deposit bonus could not be credited because the member profile was not found.';
  end if;

  insert into public.transactions (
    user_id, kind, amount, status, note, related_transaction_id
  ) values (
    new.user_id, 'adjustment', 1000, 'approved',
    'UGX 1,000 first deposit bonus', new.id
  );

  return new;
end;
$$;

revoke all on function public.credit_deposit_bonus() from public, anon, authenticated, service_role;
