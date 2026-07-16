-- Username-based login support.
-- Adds an optional username to profiles. Login maps "<username>" -> "<username>@thecoop.local"
-- (a synthetic email) on the client, so existing real-email logins keep working unchanged.
-- Run this in the Supabase SQL editor.

alter table public.profiles
  add column if not exists username text;

-- Case-insensitive uniqueness; partial so existing email-only users (null username) are unaffected.
create unique index if not exists profiles_username_key
  on public.profiles (lower(username))
  where username is not null;

-- Carry a username through from auth metadata when a user is created.
-- Idempotent; the admin-users edge function also upserts the profile explicitly.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, username, role, restaurant_access)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'username',
    'manager',
    '{}'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;
