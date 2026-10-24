alter table public.transactions
  add column if not exists payment_gateway text,
  add column if not exists provider_request_id text;

alter table public.transactions
  drop constraint if exists transactions_payment_gateway_check;
alter table public.transactions
  add constraint transactions_payment_gateway_check
  check (payment_gateway is null or payment_gateway = 'marzpay');

create unique index if not exists transactions_provider_request_id_unique
  on public.transactions (provider_request_id)
  where provider_request_id is not null;

create index if not exists transactions_pending_marzpay_withdrawals_idx
  on public.transactions (created_at)
  where kind = 'withdraw' and payment_gateway = 'marzpay' and status in ('pending', 'processing');

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
  if p_phone_number is null or p_phone_number !~ '^\+256[0-9]{9}$' then
    raise exception 'Enter a valid Uganda mobile number.';
  end if;
  if lower(coalesce(p_provider, '')) not in ('mtn', 'airtel') then
    raise exception 'Choose MTN or Airtel Mobile Money.';
  end if;

  perform 1 from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Member profile not found.'; end if;

  select * into existing_row
  from public.transactions
  where user_id = auth.uid() and kind = 'deposit' and payment_gateway = 'marzpay'
    and amount = p_amount and payment_phone = p_phone_number and status in ('pending', 'processing')
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

  insert into public.transactions (
    id, user_id, kind, amount, net_amount, status, note,
    payment_phone, payment_provider, payment_reference, payment_gateway
  ) values (
    new_transaction_id, auth.uid(), 'deposit', p_amount, p_amount, 'pending',
    'MarzPay mobile money collection pending', p_phone_number, lower(p_provider),
    new_transaction_id::text, 'marzpay'
  );

  return jsonb_build_object(
    'transaction_id', new_transaction_id,
    'reference', new_transaction_id::text,
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
  withdrawal_fee numeric(14, 0);
  payout_amount numeric(14, 0);
  minimum_amount numeric(14, 2);
  fee_percent numeric(5, 2);
  configured_start time;
  configured_end time;
  kampala_time time;
  new_transaction_id uuid := gen_random_uuid();
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
  if p_phone_number is null or p_phone_number !~ '^\+256[0-9]{9}$' then
    raise exception 'Enter a valid Uganda mobile number.';
  end if;
  if lower(coalesce(p_provider, '')) not in ('mtn', 'airtel') then
    raise exception 'Choose MTN or Airtel Mobile Money.';
  end if;

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
  where user_id = auth.uid() and kind = 'withdraw' and payment_gateway = 'marzpay'
    and amount = p_amount and payment_phone = p_phone_number and status in ('pending', 'processing')
  order by created_at desc limit 1 for update;
  if found then
    return jsonb_build_object(
      'transaction_id', existing_row.id, 'reference', existing_row.payment_reference,
      'phone_number', existing_row.payment_phone, 'provider', existing_row.payment_provider,
      'amount', existing_row.net_amount, 'gross_amount', existing_row.amount, 'fee', existing_row.fee
    );
  end if;
  if current_balance < p_amount then raise exception 'Insufficient balance.'; end if;

  withdrawal_fee := round(p_amount * coalesce(fee_percent, 20) / 100, 0);
  payout_amount := p_amount - withdrawal_fee;
  update public.profiles set balance = balance - p_amount where id = auth.uid();
  insert into public.transactions (
    id, user_id, kind, amount, fee, net_amount, status, note,
    payment_phone, payment_provider, payment_reference, payment_gateway, payout_method
  ) values (
    new_transaction_id, auth.uid(), 'withdraw', p_amount, withdrawal_fee,
    payout_amount, 'pending', 'Withdrawal request pending admin approval',
    p_phone_number, lower(p_provider), new_transaction_id::text, 'marzpay', 'api'
  );
  return jsonb_build_object(
    'transaction_id', new_transaction_id, 'reference', new_transaction_id::text,
    'phone_number', p_phone_number, 'provider', lower(p_provider),
    'amount', payout_amount, 'gross_amount', p_amount, 'fee', withdrawal_fee
  );
end;
$$;

create or replace function public.begin_marzpay_deposit(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deposit_row public.transactions%rowtype;
  should_submit boolean := false;
begin
  if auth.uid() is null then raise exception 'Sign in to start a deposit.'; end if;

  select * into deposit_row
  from public.transactions
  where id = p_transaction_id and user_id = auth.uid() and kind = 'deposit'
    and payment_gateway = 'marzpay'
  for update;
  if not found then raise exception 'MarzPay deposit request not found.'; end if;
  if deposit_row.status = 'pending' then
    update public.transactions
    set status = 'processing', note = 'MarzPay collection processing'
    where id = deposit_row.id;
    should_submit := true;
  elsif deposit_row.status <> 'processing' then
    raise exception 'This deposit is no longer awaiting payment.';
  end if;

  return jsonb_build_object(
    'transaction_id', deposit_row.id,
    'reference', deposit_row.payment_reference,
    'phone_number', deposit_row.payment_phone,
    'provider', deposit_row.payment_provider,
    'amount', deposit_row.amount,
    'provider_request_id', deposit_row.provider_request_id,
    'should_submit', should_submit
  );
end;
$$;

create or replace function public.get_pending_marzpay_withdrawals()
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
  where t.kind = 'withdraw' and t.payment_gateway = 'marzpay'
    and t.status in ('pending', 'processing')
  order by t.created_at asc;
end;
$$;

create or replace function public.begin_marzpay_withdrawal(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payout_row public.transactions%rowtype;
  should_submit boolean := false;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Only an administrator can approve payouts.';
  end if;

  select * into payout_row
  from public.transactions
  where id = p_transaction_id and kind = 'withdraw' and payment_gateway = 'marzpay'
  for update;
  if not found then raise exception 'MarzPay withdrawal request not found.'; end if;
  if payout_row.payout_method <> 'api' then
    raise exception 'This withdrawal is assigned to manual payout.';
  end if;
  if payout_row.status = 'pending' then
    update public.transactions
    set status = 'processing', approved_by = auth.uid(), approved_at = now(),
        note = 'Admin approved; MarzPay payout processing'
    where id = payout_row.id;
    should_submit := true;
  elsif payout_row.status <> 'processing' then
    raise exception 'This withdrawal is no longer awaiting payout.';
  end if;

  return jsonb_build_object(
    'transaction_id', payout_row.id,
    'reference', payout_row.payment_reference,
    'phone_number', payout_row.payment_phone,
    'provider', payout_row.payment_provider,
    'amount', payout_row.net_amount,
    'provider_request_id', payout_row.provider_request_id,
    'should_submit', should_submit
  );
end;
$$;

create or replace function public.record_marzpay_submission(
  p_transaction_id uuid,
  p_provider_request_id text,
  p_provider_status text,
  p_failure_reason text default null
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
    raise exception 'MarzPay response recording requires the service role.';
  end if;
  if coalesce(trim(p_provider_request_id), '') = ''
    or lower(coalesce(p_provider_status, '')) not in ('pending', 'processing', 'sandbox', 'completed', 'failed', 'cancelled') then
    raise exception 'Invalid MarzPay submission response.';
  end if;

  select * into payment_row from public.transactions
  where id = p_transaction_id and payment_gateway = 'marzpay'
    and kind in ('deposit', 'withdraw')
  for update;
  if not found then raise exception 'MarzPay payment request not found.'; end if;
  if payment_row.status in ('approved', 'rejected') then
    if payment_row.provider_request_id = p_provider_request_id then return; end if;
    raise exception 'This payment has already settled.';
  end if;
  if payment_row.status <> 'processing' then
    raise exception 'MarzPay payment processing has not started.';
  end if;
  if payment_row.provider_request_id is not null
    and payment_row.provider_request_id <> p_provider_request_id then
    raise exception 'MarzPay transaction ID does not match the stored request.';
  end if;

  update public.transactions
  set provider_request_id = p_provider_request_id,
      failure_reason = null,
      note = case when payment_row.kind = 'deposit'
        then 'MarzPay deposit awaiting payment confirmation'
        else 'MarzPay payout awaiting payment confirmation' end
  where id = p_transaction_id;
end;
$$;

create or replace function public.fail_marzpay_submission(
  p_transaction_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row public.transactions%rowtype;
  failure text := left(coalesce(nullif(trim(p_reason), ''), 'MarzPay rejected the request.'), 500);
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'MarzPay failure recording requires the service role.';
  end if;
  select * into payment_row from public.transactions
  where id = p_transaction_id and payment_gateway = 'marzpay'
    and kind in ('deposit', 'withdraw')
  for update;
  if not found then raise exception 'MarzPay payment request not found.'; end if;
  if payment_row.status in ('approved', 'rejected') then return; end if;
  if payment_row.provider_request_id is not null then
    raise exception 'A submitted MarzPay payment cannot be failed without provider confirmation.';
  end if;
  if payment_row.status not in ('pending', 'processing') then
    raise exception 'MarzPay payment is not awaiting submission.';
  end if;

  if payment_row.kind = 'withdraw' then
    update public.profiles set balance = balance + payment_row.amount where id = payment_row.user_id;
  end if;
  update public.transactions
  set status = 'rejected', failure_reason = failure, settled_at = now(),
      note = case when payment_row.kind = 'withdraw'
        then 'MarzPay rejected the payout; reserved balance refunded'
        else 'MarzPay rejected the deposit request' end
  where id = p_transaction_id;
end;
$$;

create or replace function public.reject_marzpay_withdrawal(p_transaction_id uuid)
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

  select * into payout_row from public.transactions
  where id = p_transaction_id and kind = 'withdraw'
    and payment_gateway = 'marzpay' and status = 'pending'
  for update;
  if not found then raise exception 'Only a pending MarzPay withdrawal can be rejected.'; end if;

  update public.profiles set balance = balance + payout_row.amount where id = payout_row.user_id;
  update public.transactions
  set status = 'rejected', approved_by = auth.uid(), approved_at = now(), settled_at = now(),
      failure_reason = 'Rejected by administrator', note = 'Withdrawal rejected; reserved balance refunded'
  where id = payout_row.id;
end;
$$;

create or replace function public.apply_marzpay_webhook(p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  event_name text;
  transaction_data jsonb;
  collection_data jsonb;
  disbursement_data jsonb;
  amount_data jsonb;
  payment_row public.transactions%rowtype;
  payment_kind text;
  event_status text;
  event_reference text;
  provider_request_id text;
  provider_transaction_id text;
  event_provider text;
  event_phone text;
  event_currency text;
  event_amount numeric;
  expected_amount numeric;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'MarzPay webhook processing requires the service role.';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'Invalid MarzPay webhook payload.'; end if;

  payload := case
    when jsonb_typeof(p_payload -> 'data') = 'object' then p_payload -> 'data'
    else p_payload
  end;
  event_name := lower(coalesce(payload ->> 'event_type', p_payload ->> 'event_type', ''));
  transaction_data := payload -> 'transaction';
  collection_data := payload -> 'collection';
  disbursement_data := payload -> 'disbursement';
  if jsonb_typeof(transaction_data) <> 'object' then raise exception 'MarzPay webhook transaction is missing.'; end if;

  if event_name like 'collection.%'
    or (event_name = '' and jsonb_typeof(collection_data) = 'object') then
    payment_kind := 'deposit';
    event_reference := coalesce(transaction_data ->> 'reference', '');
    provider_transaction_id := nullif(collection_data ->> 'provider_transaction_id', '');
    amount_data := coalesce(transaction_data -> 'amount', collection_data -> 'amount');
    event_phone := coalesce(transaction_data ->> 'phone_number', collection_data ->> 'phone_number');
    event_provider := lower(coalesce(transaction_data ->> 'provider', collection_data ->> 'provider', ''));
  elsif event_name like 'disbursement.%'
    or (event_name = '' and jsonb_typeof(disbursement_data) = 'object') then
    payment_kind := 'withdraw';
    event_reference := coalesce(transaction_data ->> 'provider_reference', '');
    provider_transaction_id := nullif(disbursement_data ->> 'provider_transaction_id', '');
    amount_data := transaction_data -> 'amount';
    event_phone := coalesce(transaction_data ->> 'phone_number', disbursement_data ->> 'phone_number');
    event_provider := lower(coalesce(transaction_data ->> 'provider', disbursement_data ->> 'provider', ''));
  elsif event_name in ('success', 'failure') then
    if jsonb_typeof(collection_data) = 'object' then
      payment_kind := 'deposit';
      event_reference := coalesce(transaction_data ->> 'reference', '');
      provider_transaction_id := nullif(collection_data ->> 'provider_transaction_id', '');
      amount_data := coalesce(transaction_data -> 'amount', collection_data -> 'amount');
      event_phone := coalesce(transaction_data ->> 'phone_number', collection_data ->> 'phone_number');
      event_provider := lower(coalesce(transaction_data ->> 'provider', collection_data ->> 'provider', ''));
    elsif jsonb_typeof(disbursement_data) = 'object' then
      payment_kind := 'withdraw';
      event_reference := coalesce(transaction_data ->> 'provider_reference', '');
      provider_transaction_id := nullif(disbursement_data ->> 'provider_transaction_id', '');
      amount_data := transaction_data -> 'amount';
      event_phone := coalesce(transaction_data ->> 'phone_number', disbursement_data ->> 'phone_number');
      event_provider := lower(coalesce(transaction_data ->> 'provider', disbursement_data ->> 'provider', ''));
    else
      raise exception 'Unsupported MarzPay event.';
    end if;
  else
    raise exception 'Unsupported MarzPay event.';
  end if;

  if event_name in ('collection.pending', 'collection.processing', 'disbursement.pending', 'disbursement.processing')
    or (event_name = '' and lower(coalesce(transaction_data ->> 'status', '')) in ('pending', 'processing')) then
    return true;
  elsif event_name in ('collection.completed', 'disbursement.completed', 'success') then
    event_status := 'completed';
  elsif event_name in ('collection.failed', 'collection.cancelled', 'disbursement.failed', 'disbursement.cancelled', 'failure') then
    event_status := 'failed';
  else
    raise exception 'Unsupported MarzPay event status.';
  end if;

  if event_reference = '' or jsonb_typeof(amount_data) <> 'object' then
    raise exception 'Incomplete MarzPay payment event.';
  end if;
  begin
    event_amount := (amount_data ->> 'raw')::numeric;
  exception when others then
    raise exception 'Invalid MarzPay payment amount.';
  end;
  event_currency := upper(coalesce(amount_data ->> 'currency', ''));
  provider_request_id := nullif(transaction_data ->> 'uuid', '');

  select * into payment_row from public.transactions
  where payment_reference = event_reference
    and payment_gateway = 'marzpay'
    and kind = payment_kind
  for update;
  if not found then raise exception 'MarzPay payment reference not found.'; end if;

  if payment_kind = 'withdraw' then
    expected_amount := payment_row.net_amount;
  else
    expected_amount := payment_row.amount;
  end if;

  if event_amount is null
    or event_amount <> trunc(event_amount)
    or event_amount <> expected_amount
    or event_currency <> 'UGX'
    or event_phone is distinct from payment_row.payment_phone
    or event_provider is distinct from payment_row.payment_provider then
    raise exception 'MarzPay payment details do not match the stored request.';
  end if;
  if payment_row.provider_request_id is not null
    and provider_request_id is distinct from payment_row.provider_request_id then
    raise exception 'MarzPay transaction ID does not match the stored request.';
  end if;
  if provider_transaction_id is not null and payment_row.provider_transaction_id is not null
    and provider_transaction_id <> payment_row.provider_transaction_id then
    raise exception 'MarzPay provider transaction ID does not match the stored request.';
  end if;
  if payment_row.status in ('approved', 'rejected') then return true; end if;
  if payment_row.status not in ('pending', 'processing')
    or (payment_kind = 'withdraw' and payment_row.approved_at is null) then
    raise exception 'MarzPay payment is not approved for settlement.';
  end if;

  if event_status = 'completed' then
    if payment_kind = 'deposit' then
      update public.profiles set balance = balance + payment_row.amount where id = payment_row.user_id;
    end if;
    update public.transactions
    set status = 'approved',
        provider_request_id = coalesce(payment_row.provider_request_id, provider_request_id),
        provider_transaction_id = coalesce(payment_row.provider_transaction_id, provider_transaction_id),
        failure_reason = null,
        settled_at = now(),
        note = case when payment_kind = 'deposit' then 'MarzPay deposit completed' else 'MarzPay payout completed' end
    where id = payment_row.id;
  else
    if payment_kind = 'withdraw' then
      update public.profiles set balance = balance + payment_row.amount where id = payment_row.user_id;
    end if;
    update public.transactions
    set status = 'rejected',
        provider_request_id = coalesce(payment_row.provider_request_id, provider_request_id),
        provider_transaction_id = coalesce(payment_row.provider_transaction_id, provider_transaction_id),
        failure_reason = coalesce(nullif(payload ->> 'failure_reason', ''), nullif(payload ->> 'failureReason', ''), event_status),
        settled_at = now(),
        note = case when payment_kind = 'deposit' then 'MarzPay deposit failed' else 'MarzPay payout failed; reserved balance refunded' end
    where id = payment_row.id;
  end if;

  return true;
end;
$$;

revoke all on function public.request_mobile_deposit(numeric, text, text) from public, anon, service_role;
revoke all on function public.request_mobile_withdrawal(numeric, text, text) from public, anon, service_role;
revoke all on function public.begin_marzpay_deposit(uuid) from public, anon, service_role;
revoke all on function public.get_pending_marzpay_withdrawals() from public, anon, service_role;
revoke all on function public.begin_marzpay_withdrawal(uuid) from public, anon, service_role;
revoke all on function public.record_marzpay_submission(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.fail_marzpay_submission(uuid, text) from public, anon, authenticated;
revoke all on function public.reject_marzpay_withdrawal(uuid) from public, anon, service_role;
revoke all on function public.apply_marzpay_webhook(jsonb) from public, anon, authenticated;

grant execute on function public.request_mobile_deposit(numeric, text, text) to authenticated;
grant execute on function public.request_mobile_withdrawal(numeric, text, text) to authenticated;
grant execute on function public.begin_marzpay_deposit(uuid) to authenticated;
grant execute on function public.get_pending_marzpay_withdrawals() to authenticated;
grant execute on function public.begin_marzpay_withdrawal(uuid) to authenticated;
grant execute on function public.record_marzpay_submission(uuid, text, text, text) to service_role;
grant execute on function public.fail_marzpay_submission(uuid, text) to service_role;
grant execute on function public.reject_marzpay_withdrawal(uuid) to authenticated;
grant execute on function public.apply_marzpay_webhook(jsonb) to service_role;

revoke all on function public.request_pesajet_deposit(numeric, text) from public, anon, authenticated, service_role;
revoke all on function public.request_pesajet_withdrawal(numeric, text) from public, anon, authenticated, service_role;
revoke all on function public.record_pesajet_deposit(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.record_pesajet_payout(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.get_pending_pesajet_withdrawals() from public, anon, authenticated, service_role;
revoke all on function public.begin_pesajet_withdrawal(uuid) from public, anon, authenticated, service_role;
revoke all on function public.reject_pesajet_withdrawal(uuid) from public, anon, authenticated, service_role;
revoke all on function public.apply_pesajet_webhook(jsonb) from public, anon, authenticated, service_role;
