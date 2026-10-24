alter table public.transactions
  add column if not exists related_transaction_id uuid references public.transactions(id);

create unique index if not exists transactions_related_transaction_id_unique
  on public.transactions (related_transaction_id)
  where related_transaction_id is not null;

create or replace function public.credit_deposit_bonus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'deposit' or new.status <> 'approved' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'approved' then
      return new;
    end if;
  end if;

  if exists (
    select 1
    from public.transactions
    where related_transaction_id = new.id
  ) then
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
    'UGX 1,000 deposit bonus', new.id
  );

  return new;
end;
$$;

revoke all on function public.credit_deposit_bonus() from public, anon, authenticated, service_role;

drop trigger if exists credit_deposit_bonus_on_deposit_approval on public.transactions;
create trigger credit_deposit_bonus_on_deposit_approval
after insert or update of status on public.transactions
for each row
execute function public.credit_deposit_bonus();
