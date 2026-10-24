create or replace function public.admin_marzpay_deposit_status(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deposit_row public.transactions%rowtype;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Only an administrator can check a deposit.';
  end if;

  select * into deposit_row
  from public.transactions
  where id = p_transaction_id and kind = 'deposit' and payment_gateway = 'marzpay'
  for update;
  if not found then raise exception 'MarzPay deposit not found.'; end if;

  return jsonb_build_object(
    'transaction_id', deposit_row.id,
    'reference', deposit_row.payment_reference,
    'provider_request_id', deposit_row.provider_request_id,
    'amount', deposit_row.amount,
    'phone_number', deposit_row.payment_phone,
    'provider', deposit_row.payment_provider,
    'status', deposit_row.status
  );
end;
$$;

create or replace function public.get_stuck_marzpay_deposits(p_limit integer default 25)
returns table (
  id uuid,
  user_id uuid,
  member_phone text,
  amount numeric,
  status text,
  payment_reference text,
  provider_request_id text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Only an administrator can list unsettled deposits.';
  end if;

  return query
  select t.id, t.user_id, p.phone, t.amount, t.status, t.payment_reference,
         t.provider_request_id, t.created_at
  from public.transactions t
  join public.profiles p on p.id = t.user_id
  where t.kind = 'deposit' and t.payment_gateway = 'marzpay'
    and t.status in ('pending', 'processing')
    and t.provider_request_id is not null
  order by t.created_at asc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

revoke all on function public.admin_marzpay_deposit_status(uuid) from public, anon, service_role;
revoke all on function public.get_stuck_marzpay_deposits(integer) from public, anon, service_role;
grant execute on function public.admin_marzpay_deposit_status(uuid) to authenticated;
grant execute on function public.get_stuck_marzpay_deposits(integer) to authenticated;
