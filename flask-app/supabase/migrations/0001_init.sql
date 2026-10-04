-- ============================================================================
-- Grant Tracker — initial schema
-- Per-user private data. Every table has a user_id that defaults to the
-- authenticated user's id, RLS is enabled, and policies restrict every row
-- to its owner. Safe to re-run on a fresh Supabase project.
-- ============================================================================

-- ── Funding areas (buckets) ─────────────────────────────────────────────────
create table if not exists public.funding_areas (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
    name        text not null,
    target      numeric not null default 0,
    notes       text,
    created_at  timestamptz not null default now()
);

-- ── Opportunities ───────────────────────────────────────────────────────────
create table if not exists public.opportunities (
    id                    uuid primary key default gen_random_uuid(),
    user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
    name                  text not null,
    funder                text,
    source_url            text,
    amount                text,
    purpose               text,
    status                text not null default 'Identified',
    deadline              date,
    notes                 text,
    specifically_funding  text,
    funding_area_id       uuid references public.funding_areas(id) on delete set null,
    created_at            timestamptz not null default now()
);

-- ── Requirements (belong to an opportunity) ─────────────────────────────────
create table if not exists public.requirements (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
    opportunity_id  uuid not null references public.opportunities(id) on delete cascade,
    description     text not null,
    status          text not null default 'Not started',
    owner           text,
    due_date        date,
    notes           text,
    created_at      timestamptz not null default now()
);

-- ── Actions (general tracker) ───────────────────────────────────────────────
create table if not exists public.actions (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
    title       text not null,
    status      text not null default 'Open',
    owner       text,
    due_date    date,
    notes       text,
    created_at  timestamptz not null default now()
);

-- ── Settings (key/value per user — e.g. overall_target) ─────────────────────
create table if not exists public.settings (
    user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
    key         text not null,
    value       text,
    primary key (user_id, key)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
create index if not exists idx_funding_areas_user   on public.funding_areas (user_id);
create index if not exists idx_opportunities_user    on public.opportunities (user_id);
create index if not exists idx_opportunities_area    on public.opportunities (funding_area_id);
create index if not exists idx_requirements_user     on public.requirements (user_id);
create index if not exists idx_requirements_opp      on public.requirements (opportunity_id);
create index if not exists idx_actions_user          on public.actions (user_id);

-- ============================================================================
-- Row Level Security
-- Enable RLS on every table, then add owner-scoped policies.
-- Policies are dropped first so this migration is idempotent.
-- ============================================================================

alter table public.funding_areas enable row level security;
alter table public.opportunities enable row level security;
alter table public.requirements  enable row level security;
alter table public.actions       enable row level security;
alter table public.settings      enable row level security;

-- Helper note: for each table we create four policies (select/insert/update/delete),
-- all gated on user_id = auth.uid(). INSERT uses WITH CHECK; UPDATE uses both.

-- ── funding_areas policies ──
drop policy if exists "funding_areas_select" on public.funding_areas;
drop policy if exists "funding_areas_insert" on public.funding_areas;
drop policy if exists "funding_areas_update" on public.funding_areas;
drop policy if exists "funding_areas_delete" on public.funding_areas;

create policy "funding_areas_select" on public.funding_areas
    for select using (user_id = auth.uid());
create policy "funding_areas_insert" on public.funding_areas
    for insert with check (user_id = auth.uid());
create policy "funding_areas_update" on public.funding_areas
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "funding_areas_delete" on public.funding_areas
    for delete using (user_id = auth.uid());

-- ── opportunities policies ──
drop policy if exists "opportunities_select" on public.opportunities;
drop policy if exists "opportunities_insert" on public.opportunities;
drop policy if exists "opportunities_update" on public.opportunities;
drop policy if exists "opportunities_delete" on public.opportunities;

create policy "opportunities_select" on public.opportunities
    for select using (user_id = auth.uid());
create policy "opportunities_insert" on public.opportunities
    for insert with check (user_id = auth.uid());
create policy "opportunities_update" on public.opportunities
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "opportunities_delete" on public.opportunities
    for delete using (user_id = auth.uid());

-- ── requirements policies ──
drop policy if exists "requirements_select" on public.requirements;
drop policy if exists "requirements_insert" on public.requirements;
drop policy if exists "requirements_update" on public.requirements;
drop policy if exists "requirements_delete" on public.requirements;

create policy "requirements_select" on public.requirements
    for select using (user_id = auth.uid());
create policy "requirements_insert" on public.requirements
    for insert with check (user_id = auth.uid());
create policy "requirements_update" on public.requirements
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "requirements_delete" on public.requirements
    for delete using (user_id = auth.uid());

-- ── actions policies ──
drop policy if exists "actions_select" on public.actions;
drop policy if exists "actions_insert" on public.actions;
drop policy if exists "actions_update" on public.actions;
drop policy if exists "actions_delete" on public.actions;

create policy "actions_select" on public.actions
    for select using (user_id = auth.uid());
create policy "actions_insert" on public.actions
    for insert with check (user_id = auth.uid());
create policy "actions_update" on public.actions
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "actions_delete" on public.actions
    for delete using (user_id = auth.uid());

-- ── settings policies ──
drop policy if exists "settings_select" on public.settings;
drop policy if exists "settings_insert" on public.settings;
drop policy if exists "settings_update" on public.settings;
drop policy if exists "settings_delete" on public.settings;

create policy "settings_select" on public.settings
    for select using (user_id = auth.uid());
create policy "settings_insert" on public.settings
    for insert with check (user_id = auth.uid());
create policy "settings_update" on public.settings
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "settings_delete" on public.settings
    for delete using (user_id = auth.uid());
