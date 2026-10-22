-- Replace this value with the member's phone number as shown in My account.
-- Example format: +2567XXXXXXXX
do $$
declare
  target_phone text := '+256REPLACE_WITH_MEMBER_PHONE';
  affected_users integer;
  verified_role text;
begin
  if target_phone !~ '^\+256[0-9]{9}$' then
    raise exception 'Set target_phone to a valid Uganda phone number in +256XXXXXXXXX format.';
  end if;

  update auth.users as auth_user
  set raw_app_meta_data =
    coalesce(auth_user.raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
  from public.profiles as member_profile
  where member_profile.id = auth_user.id
    and member_profile.phone = target_phone;

  get diagnostics affected_users = row_count;
  if affected_users <> 1 then
    raise exception 'Expected exactly one matching account for %, updated %.', target_phone, affected_users;
  end if;

  select auth_user.raw_app_meta_data ->> 'role'
  into verified_role
  from auth.users as auth_user
  join public.profiles as member_profile on member_profile.id = auth_user.id
  where member_profile.phone = target_phone;

  if verified_role <> 'admin' then
    raise exception 'Admin role verification failed for %.', target_phone;
  end if;

  raise notice 'Promoted and verified % as admin.', target_phone;
end;
$$;
