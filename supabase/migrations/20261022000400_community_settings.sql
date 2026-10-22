create table if not exists public.community_settings (
  id smallint primary key default 1 check (id = 1),
  service_chat_url text not null default ''
    check (service_chat_url = '' or service_chat_url ~ '^https://(t\.me|telegram\.me)/[^[:space:]]+$'),
  telegram_group_url text not null default ''
    check (telegram_group_url = '' or telegram_group_url ~ '^https://(t\.me|telegram\.me)/[^[:space:]]+$'),
  updated_at timestamptz not null default now()
);

alter table public.community_settings enable row level security;

create policy community_settings_read
  on public.community_settings for select to anon, authenticated
  using (true);

create policy community_settings_admin_insert
  on public.community_settings for insert to authenticated
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

create policy community_settings_admin_update
  on public.community_settings for update to authenticated
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

grant select on public.community_settings to anon, authenticated;
grant insert, update on public.community_settings to authenticated;
revoke delete on public.community_settings from anon, authenticated;
