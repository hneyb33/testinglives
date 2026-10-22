alter table public.transactions add column if not exists payment_phone text;
alter table public.transactions add column if not exists payment_provider text;
alter table public.transactions add column if not exists payment_reference text;
alter table public.transactions add column if not exists provider_transaction_id text;
alter table public.transactions add column if not exists approved_by uuid references auth.users(id);
alter table public.transactions add column if not exists approved_at timestamptz;
alter table public.transactions add column if not exists settled_at timestamptz;
alter table public.transactions add column if not exists failure_reason text;

alter table public.transactions drop constraint if exists transactions_status_check;
alter table public.transactions
  add constraint transactions_status_check
  check (status in ('pending', 'processing', 'approved', 'rejected'));

alter table public.transactions drop constraint if exists transactions_payment_provider_check;
alter table public.transactions
  add constraint transactions_payment_provider_check
  check (payment_provider is null or payment_provider in ('mtn', 'airtel'));

create unique index if not exists transactions_payment_reference_unique
  on public.transactions (payment_reference)
  where payment_reference is not null;
create unique index if not exists transactions_provider_transaction_unique
  on public.transactions (provider_transaction_id)
  where provider_transaction_id is not null;
create index if not exists transactions_pending_pesajet_withdrawals_idx
  on public.transactions (created_at)
  where kind = 'withdraw' and status in ('pending', 'processing');

create or replace function public.request_pesajet_deposit(p_amount numeric, p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_phone text;
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
  if lower(coalesce(p_provider, '')) not in ('mtn', 'airtel') then
    raise exception 'Choose MTN or Airtel Mobile Money.';
  end if;

  select phone into current_phone from public.profiles where id = auth.uid() for update;
  if not found or trim(coalesce(current_phone, '')) = '' then
    raise exception 'A registered phone number is required.';
  end if;

  select * into existing_row
  from public.transactions
  where user_id = auth.uid() and kind = 'deposit' and amount = p_amount
    and payment_provider = lower(p_provider) and status in ('pending', 'processing')
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
    'PesaJet mobile money collection pending', current_phone, lower(p_provider), new_reference
  );

  return jsonb_build_object(
    'transaction_id', new_transaction_id,
    'reference', new_reference,
    'phone_number', current_phone,
    'provider', lower(p_provider),
    'amount', p_amount
  );
end;
$$;

create or replace function public.request_pesajet_withdrawal(p_amount numeric, p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(14, 2);
  current_phone text;
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
  if lower(coalesce(p_provider, '')) not in ('mtn', 'airtel') then
    raise exception 'Choose MTN or Airtel Mobile Money.';
  end if;

  kampala_time := (now() at time zone 'Africa/Kampala')::time;
  if kampala_time < time '09:00' or kampala_time >= time '21:00' then
    raise exception 'Withdrawals are available from 9:00 AM to 9:00 PM Kampala time.';
  end if;

  select balance, phone into current_balance, current_phone
  from public.profiles where id = auth.uid() for update;
  if not found or trim(coalesce(current_phone, '')) = '' then
    raise exception 'A registered member profile and phone number are required.';
  end if;

  select * into existing_row
  from public.transactions
  where user_id = auth.uid() and kind = 'withdraw' and amount = p_amount
    and payment_provider = lower(p_provider) and status in ('pending', 'processing')
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
    payout_amount, 'pending', 'Withdrawal reserved; awaiting admin approval',
    current_phone, lower(p_provider), new_reference
  );

  return jsonb_build_object(
    'transaction_id', new_transaction_id,
    'reference', new_reference,
    'phone_number', current_phone,
    'provider', lower(p_provider),
    'amount', payout_amount,
    'gross_amount', p_amount,
    'fee', withdrawal_fee
  );
end;
$$;

create or replace function public.record_pesajet_deposit(
  p_transaction_id uuid,
  p_provider_transaction_id text,
  p_provider_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row public.transactions%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Provider response recording requires the service role.';
  end if;
  if coalesce(trim(p_provider_transaction_id), '') = '' or upper(coalesce(p_provider_status, '')) not in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED') then
    raise exception 'Invalid PesaJet collection response.';
  end if;

  select * into payment_row
  from public.transactions
  where id = p_transaction_id and kind = 'deposit'
  for update;

  if not found then
    raise exception 'Deposit request not found.';
  end if;
  if payment_row.provider_transaction_id is not null and payment_row.provider_transaction_id <> p_provider_transaction_id then
    raise exception 'PesaJet transaction ID does not match the stored collection.';
  end if;
  if payment_row.status not in ('pending', 'processing') then
    return;
  end if;

  if upper(p_provider_status) = 'COMPLETED' then
    update public.profiles
    set balance = balance + payment_row.amount
    where id = payment_row.user_id;
    update public.transactions
    set provider_transaction_id = p_provider_transaction_id, status = 'approved',
        settled_at = now(), note = 'PesaJet deposit completed'
    where id = p_transaction_id;
  elsif upper(p_provider_status) in ('FAILED', 'EXPIRED') then
    update public.transactions
    set provider_transaction_id = p_provider_transaction_id, status = 'rejected',
        failure_reason = upper(p_provider_status), settled_at = now(),
        note = 'PesaJet deposit did not complete'
    where id = p_transaction_id;
  else
    update public.transactions
    set provider_transaction_id = p_provider_transaction_id,
        status = case when upper(p_provider_status) = 'PROCESSING' then 'processing' else 'pending' end
    where id = p_transaction_id;
  end if;
end;
$$;

create or replace function public.get_pending_pesajet_withdrawals()
returns table (
  id uuid,
  user_id uuid,
  amount numeric,
  fee numeric,
  net_amount numeric,
  payment_phone text,
  payment_provider text,
  payment_reference text,
  provider_transaction_id text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Only an administrator can view payout requests.';
  end if;

  return query
  select t.id, t.user_id, t.amount, t.fee, t.net_amount, t.payment_phone,
         t.payment_provider, t.payment_reference, t.provider_transaction_id, t.status, t.created_at
  from public.transactions t
  where t.kind = 'withdraw' and t.status in ('pending', 'processing')
  order by t.created_at asc;
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

  if not found then
    raise exception 'Withdrawal request not found.';
  end if;
  if payout_row.status not in ('pending', 'processing') then
    raise exception 'This withdrawal is no longer awaiting payout.';
  end if;

  if payout_row.status = 'pending' then
    update public.transactions
    set status = 'processing', approved_by = auth.uid(), approved_at = now(),
        note = 'Admin approved; PesaJet payout processing'
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

create or replace function public.record_pesajet_payout(
  p_transaction_id uuid,
  p_provider_transaction_id text,
  p_provider_status text,
  p_failure_reason text default null
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
    raise exception 'Provider payout recording requires the service role.';
  end if;
  if coalesce(trim(p_provider_transaction_id), '') = '' or response_status not in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED') then
    raise exception 'Invalid PesaJet payout response.';
  end if;

  select * into payout_row
  from public.transactions
  where id = p_transaction_id and kind = 'withdraw'
  for update;

  if not found then
    raise exception 'Withdrawal request not found.';
  end if;
  if payout_row.status in ('approved', 'rejected') then
    if payout_row.provider_transaction_id = p_provider_transaction_id then
      return;
    end if;
    raise exception 'This withdrawal has already settled.';
  end if;
  if payout_row.status <> 'processing' then
    raise exception 'Admin approval is required before PesaJet payout.';
  end if;
  if payout_row.provider_transaction_id is not null and payout_row.provider_transaction_id <> p_provider_transaction_id then
    raise exception 'PesaJet transaction ID does not match the stored payout.';
  end if;

  if response_status in ('FAILED', 'EXPIRED') then
    update public.profiles set balance = balance + payout_row.amount where id = payout_row.user_id;
    update public.transactions
    set status = 'rejected', provider_transaction_id = p_provider_transaction_id,
        failure_reason = p_failure_reason, settled_at = now(),
        note = 'PesaJet payout failed; reserved balance refunded'
    where id = payout_row.id;
  elsif response_status = 'COMPLETED' then
    update public.transactions
    set status = 'approved', provider_transaction_id = p_provider_transaction_id,
        settled_at = now(), note = 'PesaJet payout completed'
    where id = payout_row.id;
  else
    update public.transactions
    set provider_transaction_id = p_provider_transaction_id,
        failure_reason = nullif(p_failure_reason, '')
    where id = payout_row.id;
  end if;
end;
$$;

create or replace function public.reject_pesajet_withdrawal(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  payout_row public.transactions%rowtype;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Only an administrator can reject a withdrawal.';
  end if;

  select * into payout_row
  from public.transactions
  where id = p_transaction_id and kind = 'withdraw' and status = 'pending'
  for update;

  if not found then
    raise exception 'Only a pending withdrawal can be rejected.';
  end if;

  update public.profiles set balance = balance + payout_row.amount where id = payout_row.user_id;
  update public.transactions
  set status = 'rejected', approved_by = auth.uid(), approved_at = now(), settled_at = now(),
      failure_reason = 'Rejected by administrator', note = 'Withdrawal rejected; reserved balance refunded'
  where id = payout_row.id;
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
    raise exception 'Webhook processing requires the service role.';
  end if;
  if event_name = 'ping' then
    return true;
  end if;
  if event_name = 'payment.completed' then
    event_status := 'COMPLETED';
  elsif event_name = 'payment.failed' then
    event_status := 'FAILED';
  elsif event_name = 'payment.expired' then
    event_status := 'EXPIRED';
  else
    raise exception 'Unsupported PesaJet event.';
  end if;
  if event_transaction_id = '' or (event_currency <> '' and event_currency <> 'UGX') then
    raise exception 'Incomplete PesaJet event.';
  end if;

  begin
    event_amount := (p_payload ->> 'amount')::numeric;
  exception when others then
    raise exception 'Invalid PesaJet event amount.';
  end;

  if event_reference <> '' then
    select * into payment_row
    from public.transactions
    where payment_reference = event_reference
    for update;
  else
    select * into payment_row
    from public.transactions
    where provider_transaction_id = event_transaction_id
    for update;
  end if;

  if not found then
    raise exception 'Payment reference not found.';
  end if;
  expected_amount := case when payment_row.kind = 'withdraw' then payment_row.net_amount else payment_row.amount end;
  if event_amount is null or event_amount <> expected_amount then
    raise exception 'PesaJet amount does not match the payment request.';
  end if;
  if event_provider <> '' and event_provider <> payment_row.payment_provider then
    raise exception 'PesaJet provider does not match the payment request.';
  end if;
  if payment_row.provider_transaction_id is not null and payment_row.provider_transaction_id <> event_transaction_id then
    raise exception 'PesaJet transaction ID does not match the stored request.';
  end if;
  if payment_row.status in ('approved', 'rejected') then
    return true;
  end if;

  if payment_row.kind = 'withdraw' and payment_row.status <> 'processing' then
    raise exception 'Payout was not approved before the PesaJet event.';
  end if;

  if event_status = 'COMPLETED' then
    if payment_row.kind = 'deposit' then
      update public.profiles set balance = balance + payment_row.amount where id = payment_row.user_id;
    end if;
    update public.transactions
    set status = 'approved', provider_transaction_id = event_transaction_id,
        failure_reason = null, settled_at = now(),
        note = case when payment_row.kind = 'deposit' then 'PesaJet deposit completed' else 'PesaJet payout completed' end
    where id = payment_row.id;
  else
    if payment_row.kind = 'withdraw' then
      update public.profiles set balance = balance + payment_row.amount where id = payment_row.user_id;
    end if;
    update public.transactions
    set status = 'rejected', provider_transaction_id = event_transaction_id,
        failure_reason = coalesce(nullif(p_payload ->> 'failureReason', ''), event_status),
        settled_at = now(),
        note = case when payment_row.kind = 'deposit' then 'PesaJet deposit did not complete' else 'PesaJet payout failed; reserved balance refunded' end
    where id = payment_row.id;
  end if;

  return true;
end;
$$;

revoke all on function public.request_deposit(numeric) from public, anon, authenticated;
revoke all on function public.request_withdrawal(numeric, uuid) from public, anon, authenticated;
revoke all on function public.review_money_request(uuid, boolean) from public, anon, authenticated;
revoke all on function public.request_pesajet_deposit(numeric, text) from public, anon, authenticated, service_role;
revoke all on function public.request_pesajet_withdrawal(numeric, text) from public, anon, authenticated, service_role;
revoke all on function public.record_pesajet_deposit(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.get_pending_pesajet_withdrawals() from public, anon, authenticated, service_role;
revoke all on function public.begin_pesajet_withdrawal(uuid) from public, anon, authenticated, service_role;
revoke all on function public.record_pesajet_payout(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.reject_pesajet_withdrawal(uuid) from public, anon, authenticated, service_role;
revoke all on function public.apply_pesajet_webhook(jsonb) from public, anon, authenticated, service_role;

grant execute on function public.request_pesajet_deposit(numeric, text) to authenticated;
grant execute on function public.request_pesajet_withdrawal(numeric, text) to authenticated;
grant execute on function public.record_pesajet_deposit(uuid, text, text) to service_role;
grant execute on function public.get_pending_pesajet_withdrawals() to authenticated;
grant execute on function public.begin_pesajet_withdrawal(uuid) to authenticated;
grant execute on function public.record_pesajet_payout(uuid, text, text, text) to service_role;
grant execute on function public.reject_pesajet_withdrawal(uuid) to authenticated;
grant execute on function public.apply_pesajet_webhook(jsonb) to service_role;
