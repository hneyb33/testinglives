create index if not exists transactions_phone_created_idx
  on public.transactions (payment_phone, created_at desc);

create or replace function public.stamp_transaction_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_phone is null then
    select phone into new.payment_phone
    from public.profiles
    where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_stamp_phone on public.transactions;
create trigger transactions_stamp_phone
before insert on public.transactions
for each row execute function public.stamp_transaction_phone();

update public.transactions t
set payment_phone = p.phone
from public.profiles p
where p.id = t.user_id and t.payment_phone is null;

update public.transactions
set note = case
  when note = 'PesaJet mobile money collection pending' then 'Deposit prompt requested'
  when note = 'PesaJet deposit completed' then 'Deposit successful'
  when note = 'PesaJet deposit did not complete' then 'Deposit failed'
  when note = 'Admin approved; PesaJet payout processing' then 'Admin approved; payment processing'
  when note = 'PesaJet payout failed; reserved balance refunded' then 'Withdrawal failed; reserved balance refunded'
  when note = 'PesaJet payout completed' then 'Withdrawal successful'
  else note
end
where note like '%PesaJet%';

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
begin
  if auth.uid() is null then
    raise exception 'Sign in to start a deposit.';
  end if;
  if p_amount is null or p_amount < 10000 or p_amount <> trunc(p_amount) then
    raise exception 'The minimum deposit is UGX 10,000.';
  end if;
  if p_phone_number is null or p_phone_number !~ '^\+256[0-9]{9}$' then
    raise exception 'Enter a valid Uganda mobile number.';
  end if;
  if p_provider is not null and lower(p_provider) not in ('mtn', 'airtel') then
    raise exception 'The mobile network could not be identified.';
  end if;

  select * into existing_row
  from public.transactions
  where user_id = auth.uid() and kind = 'deposit'
    and amount = p_amount and payment_phone = p_phone_number
    and status in ('pending', 'processing')
  order by created_at desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'transaction_id', existing_row.id,
      'reference', existing_row.payment_reference,
      'phone_number', existing_row.payment_phone,
      'provider', existing_row.payment_provider,
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
    'transaction_id', new_transaction_id,
    'reference', new_reference,
    'phone_number', p_phone_number,
    'provider', lower(p_provider),
    'amount', p_amount
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
  kampala_time time;
  new_transaction_id uuid := gen_random_uuid();
  new_reference text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to request a withdrawal.';
  end if;
  if p_amount is null or p_amount < 5000 or p_amount <> trunc(p_amount) then
    raise exception 'The minimum withdrawal is UGX 5,000.';
  end if;
  if p_phone_number is null or p_phone_number !~ '^\+256[0-9]{9}$' then
    raise exception 'Enter a valid Uganda mobile number.';
  end if;
  if p_provider is not null and lower(p_provider) not in ('mtn', 'airtel') then
    raise exception 'The mobile network could not be identified.';
  end if;

  kampala_time := (now() at time zone 'Africa/Kampala')::time;
  if kampala_time < time '09:00' or kampala_time >= time '21:00' then
    raise exception 'Withdrawals are available from 9:00 AM to 9:00 PM Kampala time.';
  end if;

  select balance into current_balance
  from public.profiles where id = auth.uid() for update;
  if not found then
    raise exception 'Member profile not found.';
  end if;

  select * into existing_row
  from public.transactions
  where user_id = auth.uid() and kind = 'withdraw'
    and amount = p_amount and payment_phone = p_phone_number
    and status in ('pending', 'processing')
  order by created_at desc
  limit 1
  for update;
  if found then
    return jsonb_build_object(
      'transaction_id', existing_row.id,
      'reference', existing_row.payment_reference,
      'phone_number', existing_row.payment_phone,
      'provider', existing_row.payment_provider,
      'amount', existing_row.net_amount,
      'gross_amount', existing_row.amount,
      'fee', existing_row.fee
    );
  end if;

  if current_balance < p_amount then
    raise exception 'Insufficient balance.';
  end if;

  withdrawal_fee := round(p_amount * 0.20, 2);
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
    'transaction_id', new_transaction_id,
    'reference', new_reference,
    'phone_number', p_phone_number,
    'provider', lower(p_provider),
    'amount', payout_amount,
    'gross_amount', p_amount,
    'fee', withdrawal_fee
  );
end;
$$;

drop function if exists public.get_pending_pesajet_withdrawals();
create function public.get_pending_pesajet_withdrawals()
returns table (
  id uuid,
  user_id uuid,
  member_phone text,
  amount numeric,
  fee numeric,
  net_amount numeric,
  payment_phone text,
  payment_provider text,
  payment_reference text,
  provider_transaction_id text,
  failure_reason text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Only an administrator can view withdrawal requests.';
  end if;

  return query
  select t.id, t.user_id, p.phone, t.amount, t.fee, t.net_amount, t.payment_phone,
         t.payment_provider, t.payment_reference, t.provider_transaction_id,
         t.failure_reason, t.status, t.created_at
  from public.transactions t
  join public.profiles p on p.id = t.user_id
  where t.kind = 'withdraw' and t.status in ('pending', 'processing')
  order by t.created_at asc;
end;
$$;

drop function if exists public.record_pesajet_deposit(uuid, text, text);
create function public.record_pesajet_deposit(
  p_transaction_id uuid,
  p_provider_transaction_id text,
  p_provider_status text,
  p_provider text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row public.transactions%rowtype;
  response_status text := upper(coalesce(p_provider_status, ''));
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Payment response recording requires the service role.';
  end if;
  if coalesce(trim(p_provider_transaction_id), '') = ''
    or response_status not in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED')
    or (p_provider is not null and lower(p_provider) not in ('mtn', 'airtel')) then
    raise exception 'Invalid payment response.';
  end if;

  select * into payment_row
  from public.transactions
  where id = p_transaction_id and kind = 'deposit'
  for update;

  if not found then raise exception 'Deposit request not found.'; end if;
  if payment_row.provider_transaction_id is not null
    and payment_row.provider_transaction_id <> p_provider_transaction_id then
    raise exception 'Payment transaction ID does not match the stored request.';
  end if;
  if payment_row.status not in ('pending', 'processing') then return; end if;

  if response_status = 'COMPLETED' then
    update public.profiles set balance = balance + payment_row.amount where id = payment_row.user_id;
    update public.transactions
    set provider_transaction_id = p_provider_transaction_id,
        payment_provider = coalesce(payment_row.payment_provider, lower(p_provider)),
        status = 'approved', failure_reason = null, settled_at = now(),
        note = 'Deposit successful'
    where id = p_transaction_id;
  elsif response_status in ('FAILED', 'EXPIRED') then
    update public.transactions
    set provider_transaction_id = p_provider_transaction_id,
        payment_provider = coalesce(payment_row.payment_provider, lower(p_provider)),
        status = 'rejected', failure_reason = response_status, settled_at = now(),
        note = 'Deposit failed'
    where id = p_transaction_id;
  else
    update public.transactions
    set provider_transaction_id = p_provider_transaction_id,
        payment_provider = coalesce(payment_row.payment_provider, lower(p_provider)),
        status = case when response_status = 'PROCESSING' then 'processing' else 'pending' end
    where id = p_transaction_id;
  end if;
end;
$$;

drop function if exists public.record_pesajet_payout(uuid, text, text, text);
create function public.record_pesajet_payout(
  p_transaction_id uuid,
  p_provider_transaction_id text,
  p_provider_status text,
  p_failure_reason text default null,
  p_provider text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  payout_row public.transactions%rowtype;
  response_status text := upper(coalesce(p_provider_status, ''));
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Payment response recording requires the service role.';
  end if;
  if coalesce(trim(p_provider_transaction_id), '') = ''
    or response_status not in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED')
    or (p_provider is not null and lower(p_provider) not in ('mtn', 'airtel')) then
    raise exception 'Invalid payment response.';
  end if;

  select * into payout_row
  from public.transactions
  where id = p_transaction_id and kind = 'withdraw'
  for update;

  if not found then raise exception 'Withdrawal request not found.'; end if;
  if payout_row.status in ('approved', 'rejected') then
    if payout_row.provider_transaction_id = p_provider_transaction_id then return; end if;
    raise exception 'This withdrawal has already settled.';
  end if;
  if payout_row.status <> 'processing' then
    raise exception 'Admin approval is required before payment.';
  end if;
  if payout_row.provider_transaction_id is not null
    and payout_row.provider_transaction_id <> p_provider_transaction_id then
    raise exception 'Payment transaction ID does not match the stored request.';
  end if;

  if response_status in ('FAILED', 'EXPIRED') then
    update public.profiles set balance = balance + payout_row.amount where id = payout_row.user_id;
    update public.transactions
    set status = 'rejected', provider_transaction_id = p_provider_transaction_id,
        payment_provider = coalesce(payout_row.payment_provider, lower(p_provider)),
        failure_reason = coalesce(nullif(p_failure_reason, ''), response_status), settled_at = now(),
        note = 'Withdrawal failed; reserved balance refunded'
    where id = payout_row.id;
  elsif response_status = 'COMPLETED' then
    update public.transactions
    set status = 'approved', provider_transaction_id = p_provider_transaction_id,
        payment_provider = coalesce(payout_row.payment_provider, lower(p_provider)),
        failure_reason = null, settled_at = now(), note = 'Withdrawal successful'
    where id = payout_row.id;
  else
    update public.transactions
    set provider_transaction_id = p_provider_transaction_id,
        payment_provider = coalesce(payout_row.payment_provider, lower(p_provider)),
        failure_reason = nullif(p_failure_reason, '')
    where id = payout_row.id;
  end if;
end;
$$;

create or replace function public.apply_pesajet_webhook(p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row public.transactions%rowtype;
  event_name text := coalesce(p_payload ->> 'event', '');
  event_status text;
  event_reference text := coalesce(p_payload ->> 'reference', '');
  event_transaction_id text := coalesce(p_payload ->> 'transactionId', '');
  event_currency text := upper(coalesce(p_payload ->> 'currency', ''));
  event_provider text := lower(coalesce(p_payload ->> 'provider', ''));
  event_amount numeric;
  expected_amount numeric(14, 2);
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Payment update requires the service role.';
  end if;
  if event_name = 'ping' then return true; end if;
  if event_name = 'payment.completed' then
    event_status := 'COMPLETED';
  elsif event_name = 'payment.failed' then
    event_status := 'FAILED';
  elsif event_name = 'payment.expired' then
    event_status := 'EXPIRED';
  else
    raise exception 'Unsupported payment event.';
  end if;
  if event_transaction_id = '' or (event_currency <> '' and event_currency <> 'UGX') then
    raise exception 'Incomplete payment event.';
  end if;

  begin
    event_amount := (p_payload ->> 'amount')::numeric;
  exception when others then
    raise exception 'Invalid payment event amount.';
  end;

  if event_reference <> '' then
    select * into payment_row from public.transactions
    where payment_reference = event_reference for update;
  else
    select * into payment_row from public.transactions
    where provider_transaction_id = event_transaction_id for update;
  end if;
  if not found then raise exception 'Payment reference not found.'; end if;

  expected_amount := case when payment_row.kind = 'withdraw' then payment_row.net_amount else payment_row.amount end;
  if event_amount is null or event_amount <> expected_amount then
    raise exception 'Payment amount does not match the request.';
  end if;
  if event_provider <> '' and payment_row.payment_provider is not null
    and event_provider <> payment_row.payment_provider then
    raise exception 'Payment network does not match the request.';
  end if;
  if payment_row.provider_transaction_id is not null
    and payment_row.provider_transaction_id <> event_transaction_id then
    raise exception 'Payment transaction ID does not match the stored request.';
  end if;
  if payment_row.status in ('approved', 'rejected') then return true; end if;
  if payment_row.kind = 'withdraw' and payment_row.status <> 'processing' then
    raise exception 'Withdrawal was not approved before payment.';
  end if;

  if event_status = 'COMPLETED' then
    if payment_row.kind = 'deposit' then
      update public.profiles set balance = balance + payment_row.amount where id = payment_row.user_id;
    end if;
    update public.transactions
    set status = 'approved', provider_transaction_id = event_transaction_id,
        payment_provider = coalesce(payment_row.payment_provider, nullif(event_provider, '')),
        failure_reason = null, settled_at = now(),
        note = case when payment_row.kind = 'deposit' then 'Deposit successful' else 'Withdrawal successful' end
    where id = payment_row.id;
  else
    if payment_row.kind = 'withdraw' then
      update public.profiles set balance = balance + payment_row.amount where id = payment_row.user_id;
    end if;
    update public.transactions
    set status = 'rejected', provider_transaction_id = event_transaction_id,
        payment_provider = coalesce(payment_row.payment_provider, nullif(event_provider, '')),
        failure_reason = coalesce(nullif(p_payload ->> 'failureReason', ''), event_status),
        settled_at = now(),
        note = case when payment_row.kind = 'deposit' then 'Deposit failed' else 'Withdrawal failed; reserved balance refunded' end
    where id = payment_row.id;
  end if;

  return true;
end;
$$;

create or replace function public.get_admin_transaction_log(
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  user_id uuid,
  member_phone text,
  kind text,
  amount numeric,
  status text,
  note text,
  fee numeric,
  net_amount numeric,
  payment_phone text,
  payment_provider text,
  payment_reference text,
  provider_transaction_id text,
  failure_reason text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required to view all transactions.';
  end if;

  return query
  select t.id, t.user_id, p.phone, t.kind, t.amount, t.status, t.note, t.fee,
         t.net_amount, t.payment_phone, t.payment_provider, t.payment_reference,
         t.provider_transaction_id, t.failure_reason, t.created_at
  from public.transactions t
  join public.profiles p on p.id = t.user_id
  order by t.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.request_mobile_deposit(numeric, text, text) from public, anon;
revoke all on function public.request_mobile_withdrawal(numeric, text, text) from public, anon;
revoke all on function public.get_admin_transaction_log(integer, integer) from public, anon;
revoke all on function public.get_pending_pesajet_withdrawals() from public, anon, authenticated;
revoke all on function public.stamp_transaction_phone() from public, anon, authenticated;
revoke all on function public.request_pesajet_deposit(numeric, text) from public, anon, authenticated;
revoke all on function public.request_pesajet_withdrawal(numeric, text) from public, anon, authenticated;
revoke all on function public.record_pesajet_deposit(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.record_pesajet_payout(uuid, text, text, text, text) from public, anon, authenticated;

grant execute on function public.request_mobile_deposit(numeric, text, text) to authenticated;
grant execute on function public.request_mobile_withdrawal(numeric, text, text) to authenticated;
grant execute on function public.get_admin_transaction_log(integer, integer) to authenticated;
grant execute on function public.get_pending_pesajet_withdrawals() to authenticated;
grant execute on function public.record_pesajet_deposit(uuid, text, text, text) to service_role;
grant execute on function public.record_pesajet_payout(uuid, text, text, text, text) to service_role;
