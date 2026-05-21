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

-- Migrations (run these if upgrading from original schema)
-- ALTER TABLE subscriptions
--   ADD COLUMN IF NOT EXISTS starts_at timestamptz DEFAULT now(),
--   ADD COLUMN IF NOT EXISTS granted_by_admin boolean DEFAULT false,
--   ADD COLUMN IF NOT EXISTS price_paid int DEFAULT 0,
--   ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by bigint;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

create table if not exists referrals (
  id          bigserial primary key,
  referrer_id bigint not null references users(telegram_id),
  referee_id  bigint not null references users(telegram_id),
  status      text default 'pending',   -- 'pending' | 'paid'
  bonus_days  int default 0,
  bonus_applied boolean default false,
  created_at  timestamptz default now(),
  unique(referee_id)
);

create table if not exists support_messages (
  id          bigserial primary key,
  telegram_id bigint not null,
  user_name   text,
  direction   text not null,            -- 'inbound' | 'outbound'
  message     text not null,
  read_at     timestamptz,
  created_at  timestamptz default now()
);

create table if not exists payment_orders (
  order_id    text primary key,
  telegram_id bigint not null,
  plan        text not null,
  price       int not null default 0,
  processed   boolean default false,
  created_at  timestamptz default now()
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
