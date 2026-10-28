-- ============================================================
-- FeeFlow backend. Run ONCE in Supabase: SQL Editor > New query > paste > Run.
-- Safe to read top to bottom. Nothing here is visible to app users.
-- ============================================================

-- 1. TABLES ---------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  biz text,
  role text not null default 'user' check (role in ('user','admin')),
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen timestamptz
);
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro')),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.app_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.coupons (
  code text primary key,
  days int not null check (days > 0 and days <= 3650),
  max_uses int,
  used_count int not null default 0,
  active boolean not null default true,
  valid_until date,
  created_at timestamptz not null default now()
);
create table if not exists public.coupon_redemptions (
  user_id uuid references auth.users(id) on delete cascade,
  code text references public.coupons(code) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (user_id, code)
);
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null
);

insert into public.app_config(key, value) values
  ('announcement', '{"on":false,"text":""}'),
  ('min_app_version', '0')
on conflict (key) do nothing;

-- The FREEPRO coupon: 30 days of Pro, anyone, once per user.
insert into public.coupons(code, days) values ('FREEPRO', 30)
on conflict (code) do nothing;

-- 2. HELPERS --------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and not blocked)
$$;

create or replace function public.is_blocked() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select blocked from profiles where id = auth.uid()), false)
$$;

-- 3. NEW USER: profile + FREE plan (no automatic trial) -------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, email, biz) values (new.id, lower(new.email), new.raw_user_meta_data->>'biz');
  insert into subscriptions(user_id) values (new.id);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. ROW LEVEL SECURITY ---------------------------------------
alter table public.profiles           enable row level security;
alter table public.subscriptions      enable row level security;
alter table public.app_data           enable row level security;
alter table public.coupons            enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.app_config         enable row level security;

drop policy if exists p_sel on public.profiles;
drop policy if exists p_upd on public.profiles;
create policy p_sel on public.profiles for select using (id = auth.uid() or is_admin());
create policy p_upd on public.profiles for update using (is_admin()) with check (is_admin());

drop policy if exists s_sel on public.subscriptions;
drop policy if exists s_upd on public.subscriptions;
create policy s_sel on public.subscriptions for select using (user_id = auth.uid() or is_admin());
create policy s_upd on public.subscriptions for update using (is_admin()) with check (is_admin());

drop policy if exists d_sel on public.app_data;
drop policy if exists d_ins on public.app_data;
drop policy if exists d_upd on public.app_data;
create policy d_sel on public.app_data for select using (user_id = auth.uid() and not is_blocked());
create policy d_ins on public.app_data for insert with check (user_id = auth.uid() and not is_blocked());
create policy d_upd on public.app_data for update using (user_id = auth.uid() and not is_blocked())
  with check (user_id = auth.uid() and not is_blocked());

drop policy if exists c_all on public.coupons;
create policy c_all on public.coupons for all using (is_admin()) with check (is_admin());

drop policy if exists r_sel on public.coupon_redemptions;
create policy r_sel on public.coupon_redemptions for select using (is_admin());

drop policy if exists g_sel on public.app_config;
drop policy if exists g_all on public.app_config;
create policy g_sel on public.app_config for select using (true);
create policy g_all on public.app_config for all using (is_admin()) with check (is_admin());

-- 5. THE LOCK: database refuses changes the plan does not allow
create or replace function public.guard_app_data() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s subscriptions%rowtype;
  nm int; om int := 0; np int; op int := 0;
  active boolean; expired boolean;
begin
  select * into s from subscriptions where user_id = new.user_id;
  nm := coalesce(jsonb_array_length(case when jsonb_typeof(new.data->'members') = 'array' then new.data->'members' end), 0);
  np := coalesce(jsonb_array_length(case when jsonb_typeof(new.data->'pays')    = 'array' then new.data->'pays'    end), 0);
  if tg_op = 'UPDATE' then
    om := coalesce(jsonb_array_length(case when jsonb_typeof(old.data->'members') = 'array' then old.data->'members' end), 0);
    op := coalesce(jsonb_array_length(case when jsonb_typeof(old.data->'pays')    = 'array' then old.data->'pays'    end), 0);
  end if;
  active  := s.plan = 'pro' and s.expires_at is not null and s.expires_at > now();
  expired := s.plan = 'pro' and not active;
  if expired and (nm > om or np > op) then
    raise exception 'Your Pro plan has ended. Redeem a code to add members or payments.';
  end if;
  if s.plan = 'free' and nm > 15 and nm > om then
    raise exception 'Free plan is limited to 15 members. Redeem a code for Pro.';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists app_data_guard on public.app_data;
create trigger app_data_guard before insert or update on public.app_data
  for each row execute function public.guard_app_data();

-- 6. COUPON REDEMPTION (the only way a user can get Pro) ------
create or replace function public.redeem_coupon(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c coupons%rowtype; s subscriptions%rowtype; base timestamptz; newexp timestamptz;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if is_blocked() then raise exception 'This account is blocked'; end if;
  select * into c from coupons where code = upper(trim(p_code));
  if not found or not c.active then raise exception 'That code isn’t valid'; end if;
  if c.valid_until is not null and c.valid_until < current_date then raise exception 'This code has expired'; end if;
  if c.max_uses is not null and c.used_count >= c.max_uses then raise exception 'This code has been fully used'; end if;
  begin
    insert into coupon_redemptions(user_id, code) values (auth.uid(), c.code);
  exception when unique_violation then
    raise exception 'You’ve already used this code';
  end;
  update coupons set used_count = used_count + 1 where code = c.code;
  select * into s from subscriptions where user_id = auth.uid();
  base := case when s.plan = 'pro' and s.expires_at > now() then s.expires_at else now() end;
  newexp := base + make_interval(days => c.days);
  update subscriptions set plan = 'pro', expires_at = newexp, updated_at = now() where user_id = auth.uid();
  return jsonb_build_object('expires_at', newexp, 'days', c.days);
end $$;

-- 7. SMALL USER FUNCTIONS -------------------------------------
create or replace function public.touch_seen() returns void
language sql security definer set search_path = public as $$
  update profiles set last_seen = now() where id = auth.uid()
$$;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- 8. ADMIN FUNCTIONS (each checks is_admin() itself) ----------
create or replace function public.admin_users() returns table(
  id uuid, email text, biz text, role text, blocked boolean, created_at timestamptz,
  last_seen timestamptz, plan text, expires_at timestamptz, members int, payments int)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  return query
  select p.id, p.email, p.biz, p.role, p.blocked, p.created_at, p.last_seen, s.plan, s.expires_at,
    coalesce(jsonb_array_length(case when jsonb_typeof(a.data->'members') = 'array' then a.data->'members' end), 0),
    coalesce(jsonb_array_length(case when jsonb_typeof(a.data->'pays')    = 'array' then a.data->'pays'    end), 0)
  from profiles p
  left join subscriptions s on s.user_id = p.id
  left join app_data a on a.user_id = p.id
  order by p.created_at desc;
end $$;

create or replace function public.admin_grant(p_user uuid, p_days int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare r timestamptz;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if p_days < 1 or p_days > 3650 then raise exception 'Days must be between 1 and 3650'; end if;
  update subscriptions
     set plan = 'pro', expires_at = greatest(now(), coalesce(expires_at, now())) + make_interval(days => p_days), updated_at = now()
   where user_id = p_user returning expires_at into r;
  return r;
end $$;

create or replace function public.admin_revoke(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  update subscriptions set plan = 'free', expires_at = null, updated_at = now() where user_id = p_user;
end $$;

-- 9. WHO CAN CALL WHAT ----------------------------------------
revoke all on function public.redeem_coupon(text), public.touch_seen(), public.delete_my_account(),
  public.admin_users(), public.admin_grant(uuid, int), public.admin_revoke(uuid) from public, anon;
grant execute on function public.redeem_coupon(text), public.touch_seen(), public.delete_my_account(),
  public.admin_users(), public.admin_grant(uuid, int), public.admin_revoke(uuid) to authenticated;

-- 10. MAKE YOURSELF ADMIN (do this AFTER you sign up in the app) ----
-- Replace the email, then run just this one line:
-- update public.profiles set role = 'admin' where email = 'you@example.com';
