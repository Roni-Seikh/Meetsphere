-- MeetSphere initial schema. Run in Supabase SQL Editor (or via supabase CLI).
-- Design: the Node server uses the service-role key (bypasses RLS) and enforces
-- authorization itself. RLS + explicit GRANTs protect the Data API for any direct
-- browser access (anon / authenticated roles).

create extension if not exists pgcrypto;

-- ---------- profiles ----------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- auto-create a profile on signup
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- meetings ----------
create table public.meetings (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[a-z]{3}-[a-z]{4}-[a-z]{3}$'),
  host_id       uuid not null references public.profiles(id) on delete restrict,
  title         text not null check (char_length(title) between 1 and 120),
  status        text not null default 'scheduled' check (status in ('scheduled','live','ended')),
  scheduled_for timestamptz,
  access_mode   text not null default 'open' check (access_mode in ('open','waiting_room','invite_only')),
  password_hash text,                      -- bcrypt/argon2 hash computed by server, never plaintext
  max_participants smallint not null default 4 check (max_participants between 2 and 8),
  started_at    timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz not null default now()
);
create index meetings_host_idx   on public.meetings (host_id, created_at desc);
create index meetings_status_idx on public.meetings (status) where status <> 'ended';

-- ---------- meeting_participants (join/leave history + roles) ----------
create table public.meeting_participants (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'participant' check (role in ('host','participant')),
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  removed_by uuid references public.profiles(id)
);
create index mp_meeting_idx on public.meeting_participants (meeting_id, joined_at);
create index mp_user_idx    on public.meeting_participants (user_id, joined_at desc);
-- at most one *open* session per user per meeting (prevents duplicate participants)
create unique index mp_one_active_session
  on public.meeting_participants (meeting_id, user_id) where left_at is null;

-- ---------- meeting_messages ----------
create table public.meeting_messages (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index mm_meeting_time_idx on public.meeting_messages (meeting_id, created_at);

-- ---------- meeting_events (audit trail) ----------
create table public.meeting_events (
  id         bigint generated always as identity primary key,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  type       text not null check (type in ('created','started','joined','left','removed','ended','screen_share_started','screen_share_stopped')),
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index me_meeting_time_idx on public.meeting_events (meeting_id, created_at);

-- ---------- Row Level Security ----------
alter table public.profiles             enable row level security;
alter table public.meetings             enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.meeting_messages     enable row level security;
alter table public.meeting_events       enable row level security;

-- helper: is the caller a participant (past or present) of the meeting?
create or replace function public.is_meeting_member(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.meeting_participants
                 where meeting_id = m and user_id = auth.uid())
      or exists (select 1 from public.meetings where id = m and host_id = auth.uid());
$$;

-- profiles: anyone signed in can read names; only owner can update own row
create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- meetings: members read; host updates. Creation/ending goes through the server API.
create policy meetings_read on public.meetings for select to authenticated
  using (host_id = auth.uid() or public.is_meeting_member(id));

create policy mp_read on public.meeting_participants for select to authenticated
  using (public.is_meeting_member(meeting_id));

create policy mm_read on public.meeting_messages for select to authenticated
  using (public.is_meeting_member(meeting_id));
-- No insert policy on messages: all writes go through the authorized Socket.IO server.

create policy me_read on public.meeting_events for select to authenticated
  using (public.is_meeting_member(meeting_id));

-- ---------- Explicit grants (required by Supabase Data API changes in 2026) ----------
grant usage on schema public to authenticated;
grant select, update on public.profiles             to authenticated;
grant select         on public.meetings             to authenticated;
grant select         on public.meeting_participants to authenticated;
grant select         on public.meeting_messages     to authenticated;
grant select         on public.meeting_events       to authenticated;
-- anon gets nothing. service_role (server only) bypasses RLS.
