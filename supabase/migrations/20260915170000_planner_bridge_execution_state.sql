create table if not exists public.planner_execution_states (
  id uuid primary key default gen_random_uuid(),
  execution_id text not null,
  task_id text not null,
  owner_user_id uuid references auth.users(id) on delete cascade,
  namespace text not null default 'default',
  phase integer not null check (phase > 0),
  status text not null check (status in ('pending','ready','running','completed','blocked','failed')),
  node jsonb not null default '{}'::jsonb,
  prerequisites jsonb not null default '[]'::jsonb,
  completed_prerequisites jsonb not null default '[]'::jsonb,
  execution_order integer not null check (execution_order > 0),
  state_version bigint not null default 1 check (state_version > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (execution_id, task_id)
);

create table if not exists public.task_graph_batches (
  id uuid primary key default gen_random_uuid(),
  execution_id text not null,
  owner_user_id uuid references auth.users(id) on delete cascade,
  namespace text not null default 'default',
  phase integer not null check (phase > 0),
  task_ids jsonb not null default '[]'::jsonb,
  task_graph_plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (execution_id, phase)
);

create index if not exists planner_execution_states_execution_idx
  on public.planner_execution_states(execution_id, phase, execution_order);

create index if not exists planner_execution_states_owner_idx
  on public.planner_execution_states(owner_user_id, updated_at desc);

create index if not exists task_graph_batches_execution_idx
  on public.task_graph_batches(execution_id, phase);

create index if not exists task_graph_batches_owner_idx
  on public.task_graph_batches(owner_user_id, updated_at desc);

alter table public.planner_execution_states enable row level security;
alter table public.task_graph_batches enable row level security;

create policy planner_execution_states_select_own
  on public.planner_execution_states
  for select
  to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy planner_execution_states_insert_own
  on public.planner_execution_states
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_user_id);

create policy planner_execution_states_update_own
  on public.planner_execution_states
  for update
  to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

create policy task_graph_batches_select_own
  on public.task_graph_batches
  for select
  to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy task_graph_batches_insert_own
  on public.task_graph_batches
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_user_id);

create policy task_graph_batches_update_own
  on public.task_graph_batches
  for update
  to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);
