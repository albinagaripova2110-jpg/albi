-- Run this in Supabase SQL Editor

create table if not exists users (
  id            bigserial primary key,
  telegram_id   bigint unique not null,
  name          text,
  username      text,
  created_at    timestamptz default now(),
  last_seen_at  timestamptz default now()
);

create table if not exists scans (
  id          bigserial primary key,
  user_id     bigint references users(telegram_id),
  created_at  timestamptz default now(),
  calories    int
);

create table if not exists subscriptions (
  id          bigserial primary key,
  user_id     bigint references users(telegram_id) unique,
  plan        text default 'free',   -- 'free' | 'pro'
  expires_at  timestamptz,
  paid_at     timestamptz,
  amount      int                    -- in kopecks/stars
);

-- Index for fast scan counting per user
create index if not exists scans_user_id_idx on scans(user_id);
create index if not exists scans_created_at_idx on scans(created_at);

-- View for admin panel
create or replace view admin_users as
select
  u.telegram_id,
  u.name,
  u.username,
  u.created_at,
  u.last_seen_at,
  count(s.id)           as total_scans,
  coalesce(sub.plan, 'free') as plan,
  sub.expires_at
from users u
left join scans s on s.user_id = u.telegram_id
left join subscriptions sub on sub.user_id = u.telegram_id
group by u.telegram_id, u.name, u.username, u.created_at, u.last_seen_at, sub.plan, sub.expires_at
order by u.created_at desc;
