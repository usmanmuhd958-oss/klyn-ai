create table if not exists public.executions (
  id uuid primary key default gen_random_uuid(),
  execution_id text not null unique,
  status text not null check (status in ('pending','queued','running','succeeded','failed','cancelled','skipped')),
  dag_id text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_logs (
  id uuid primary key default gen_random_uuid(),
  execution_id text not null,
  agent_id text not null,
  level text not null default 'info' check (level in ('debug','info','warn','error')),
  event text not null,
  message text,
  payload jsonb not null default '{}'::jsonb,
  sequence bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.dag_states (
  id uuid primary key default gen_random_uuid(),
  execution_id text not null,
  dag_id text not null,
  node_id text not null,
  state text not null check (state in ('pending','queued','running','succeeded','failed','cancelled','skipped')),
  attempt integer not null default 0 check (attempt >= 0),
  error jsonb,
  result jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (execution_id, node_id)
);

create table if not exists public.provider_telemetry (
  id uuid primary key default gen_random_uuid(),
  execution_id text,
  agent_id text,
  provider text not null,
  model text not null,
  attempt integer not null default 1 check (attempt > 0),
  status text not null check (status in ('success','error','fallback','timeout','rate_limited')),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists executions_status_idx on public.executions(status);
create index if not exists executions_updated_at_idx on public.executions(updated_at desc);
create index if not exists agent_logs_execution_idx on public.agent_logs(execution_id, created_at);
create index if not exists dag_states_execution_idx on public.dag_states(execution_id, updated_at);
create index if not exists provider_telemetry_execution_idx on public.provider_telemetry(execution_id, created_at);
create index if not exists provider_telemetry_provider_idx on public.provider_telemetry(provider, created_at);

alter table public.executions enable row level security;
alter table public.agent_logs enable row level security;
alter table public.dag_states enable row level security;
alter table public.provider_telemetry enable row level security;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'executions_set_updated_at') then
    begin
      create trigger executions_set_updated_at before update on public.executions for each row execute function public.update_updated_at_column();
    exception when undefined_function then
      null;
    end;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'executions') then
      alter publication supabase_realtime add table public.executions;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_logs') then
      alter publication supabase_realtime add table public.agent_logs;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dag_states') then
      alter publication supabase_realtime add table public.dag_states;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'provider_telemetry') then
      alter publication supabase_realtime add table public.provider_telemetry;
    end if;
  end if;
end $$;
