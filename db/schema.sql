-- =====================================================================
-- 口袋旅行 · Supabase 后端 schema
-- 在 Supabase 控制台 → SQL Editor 里整段粘贴运行一次即可。
-- 可重复运行（用了 if not exists / drop policy if exists）。
--
-- 设计要点：
--   trips        一份行程 = 一行，data(jsonb) 存整份行程文档 {P,DAYS,RES,S}
--   trip_members 行程的「协作者」（不含拥有者，拥有者记在 trips.owner）
--   trip_invites 6 位邀请码（默认 7 天有效）
--   profiles     用户昵称/邮箱，用于共享时显示「谁的行程」「谁在协作」
--
-- 权限模型：
--   拥有者：可读/改/删/邀请
--   协作者：可读/改（不可删、不可邀请）
--   RLS 里跨表判断成员关系时，用 SECURITY DEFINER 小函数绕开递归
--   （trips 的策略要查 trip_members，trip_members 的策略要查 trips，
--     直接互相引用会触发 Postgres RLS 无限递归——这是 Supabase 常见坑）
-- =====================================================================

-- ---------- 扩展 ----------
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- =====================================================================
-- 表
-- =====================================================================

-- 用户资料（共享时显示名字）
create table if not exists public.profiles (
  id    uuid primary key references auth.users (id) on delete cascade,
  name  text,
  email text
);

-- 行程
create table if not exists public.trips (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users (id) on delete cascade,
  title      text not null default '新的旅行',
  emoji      text not null default '🧳',
  data       jsonb not null default '{}'::jsonb,   -- 整份行程文档
  version    integer not null default 1,           -- 乐观并发 / 实时去重用
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trips_owner_idx on public.trips (owner);

-- 协作者（拥有者不在此表内）
create table if not exists public.trip_members (
  trip_id    uuid not null references public.trips (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'editor',   -- editor / viewer（预留）
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index if not exists trip_members_user_idx on public.trip_members (user_id);

-- 邀请码
create table if not exists public.trip_invites (
  code       text primary key,
  trip_id    uuid not null references public.trips (id) on delete cascade,
  role       text not null default 'editor',
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
create index if not exists trip_invites_trip_idx on public.trip_invites (trip_id);

-- =====================================================================
-- 防递归的成员关系判断（SECURITY DEFINER：以函数属主身份运行，绕开 RLS）
-- =====================================================================

create or replace function public.is_trip_owner(p_trip uuid, p_uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from trips where id = p_trip and owner = p_uid);
$$;

create or replace function public.is_trip_member(p_trip uuid, p_uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from trip_members where trip_id = p_trip and user_id = p_uid);
$$;

-- =====================================================================
-- 打开 RLS
-- =====================================================================
alter table public.profiles      enable row level security;
alter table public.trips         enable row level security;
alter table public.trip_members  enable row level security;
alter table public.trip_invites  enable row level security;

-- ---------- profiles ----------
-- 客户端只会 upsert 自己这一行；别人的名字由下方 SECURITY DEFINER 的 RPC 读，
-- 因此这里只放开「自己这一行」即可，最大化隐私。
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_self_upsert on public.profiles;
create policy profiles_self_upsert on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------- trips ----------
-- 读：拥有者或协作者
drop policy if exists trips_read on public.trips;
create policy trips_read on public.trips
  for select using (
    owner = auth.uid() or public.is_trip_member(id, auth.uid())
  );

-- 建：只能把 owner 设成自己
drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips
  for insert with check (owner = auth.uid());

-- 改：拥有者或协作者都能改（这就是「共享后双方都能编辑」）
drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips
  for update using (
    owner = auth.uid() or public.is_trip_member(id, auth.uid())
  ) with check (
    owner = auth.uid() or public.is_trip_member(id, auth.uid())
  );

-- 删：仅拥有者
drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips
  for delete using (owner = auth.uid());

-- ---------- trip_members ----------
-- 读：本人的成员行，或该行程拥有者（用于 listMembers 的兜底；正常走 RPC）
drop policy if exists members_read on public.trip_members;
create policy members_read on public.trip_members
  for select using (
    user_id = auth.uid() or public.is_trip_owner(trip_id, auth.uid())
  );

-- 加入只走 redeem_trip_invite（SECURITY DEFINER），这里不放开直接 insert。
-- 删：本人退出，或拥有者移除某协作者
drop policy if exists members_delete on public.trip_members;
create policy members_delete on public.trip_members
  for delete using (
    user_id = auth.uid() or public.is_trip_owner(trip_id, auth.uid())
  );

-- ---------- trip_invites ----------
-- 建：仅行程拥有者
drop policy if exists invites_insert on public.trip_invites;
create policy invites_insert on public.trip_invites
  for insert with check (public.is_trip_owner(trip_id, auth.uid()));

-- 读：仅拥有者（兑换走 RPC，普通用户不需要、也不应枚举邀请码）
drop policy if exists invites_read on public.trip_invites;
create policy invites_read on public.trip_invites
  for select using (public.is_trip_owner(trip_id, auth.uid()));

-- 删：仅拥有者（可主动作废邀请）
drop policy if exists invites_delete on public.trip_invites;
create policy invites_delete on public.trip_invites
  for delete using (public.is_trip_owner(trip_id, auth.uid()));

-- =====================================================================
-- RPC（都被 store.js 直接调用，函数名/参数名/返回列必须一致）
-- =====================================================================

-- 列出「我拥有的 + 分享给我的」行程，带角色和拥有者名字
create or replace function public.list_my_trips()
returns table (
  id uuid,
  title text,
  emoji text,
  version integer,
  updated_at timestamptz,
  role text,
  owner_name text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    t.id, t.title, t.emoji, t.version, t.updated_at,
    case when t.owner = auth.uid() then 'owner' else m.role end as role,
    p.name as owner_name
  from trips t
  left join trip_members m on m.trip_id = t.id and m.user_id = auth.uid()
  left join profiles p on p.id = t.owner
  where t.owner = auth.uid() or m.user_id = auth.uid()
  order by t.updated_at desc nulls last;
$$;

-- 兑换邀请码 → 把自己加进协作者，返回 trip_id
create or replace function public.redeem_trip_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip uuid;
  v_role text;
  v_exp  timestamptz;
begin
  select trip_id, role, expires_at
    into v_trip, v_role, v_exp
  from trip_invites
  where code = upper(trim(p_code));

  if v_trip is null then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;

  if v_exp is not null and v_exp < now() then
    raise exception 'invite_expired' using errcode = 'P0003';
  end if;

  -- 拥有者点自己的邀请码：无需加入，直接返回
  if exists (select 1 from trips where id = v_trip and owner = auth.uid()) then
    return v_trip;
  end if;

  insert into trip_members (trip_id, user_id, role)
  values (v_trip, auth.uid(), coalesce(v_role, 'editor'))
  on conflict (trip_id, user_id) do nothing;

  return v_trip;
end;
$$;

-- 列出某行程的所有人（拥有者 + 协作者），带名字和角色
create or replace function public.list_trip_members(p_trip uuid)
returns table (
  user_id uuid,
  name text,
  role text
)
language sql
security definer
stable
set search_path = public
as $$
  select u.user_id, u.name, u.role
  from (
    -- 拥有者
    select t.owner as user_id, p.name as name, 'owner'::text as role
    from trips t
    left join profiles p on p.id = t.owner
    where t.id = p_trip
    union all
    -- 协作者
    select m.user_id, p.name, m.role
    from trip_members m
    left join profiles p on p.id = m.user_id
    where m.trip_id = p_trip
  ) u
  -- 仅当调用者是该行程的拥有者或成员时才返回
  where public.is_trip_owner(p_trip, auth.uid())
     or public.is_trip_member(p_trip, auth.uid());
$$;

-- =====================================================================
-- 实时：让 trips 的 UPDATE 能推送给协作者（store.js 订阅了它做双人同步）
-- 实时也遵守 RLS 的 SELECT 策略，所以只有拥有者/协作者能收到。
-- =====================================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.trips;
  exception when duplicate_object then
    null; -- 已经加过了，忽略
  end;
end $$;

-- 完成。回到 app/config.js 填入 SUPABASE_URL 和 SUPABASE_ANON_KEY 即可启用云端。
