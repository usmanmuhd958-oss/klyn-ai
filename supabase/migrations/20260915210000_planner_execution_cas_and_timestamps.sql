alter table public.planner_execution_states
  drop constraint if exists planner_execution_states_status_check;

alter table public.planner_execution_states
  add constraint planner_execution_states_status_check
  check (status in ('pending', 'queued', 'executing', 'completed', 'failed'));

create or replace function public.touch_planner_execution_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

create or replace function public.enforce_planner_execution_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.state_version <> old.state_version + 1 then
    raise exception using
      errcode = '40001',
      message = 'planner state version must increment by exactly one',
      detail = format('expected state_version=%s, received=%s', old.state_version + 1, new.state_version);
  end if;
  return new;
end;
$$;

drop trigger if exists planner_execution_states_updated_at on public.planner_execution_states;
create trigger planner_execution_states_updated_at
before update on public.planner_execution_states
for each row
execute function public.touch_planner_execution_updated_at();

drop trigger if exists planner_execution_states_version_guard on public.planner_execution_states;
create trigger planner_execution_states_version_guard
before update on public.planner_execution_states
for each row
execute function public.enforce_planner_execution_version();

drop trigger if exists task_graph_batches_updated_at on public.task_graph_batches;
create trigger task_graph_batches_updated_at
before update on public.task_graph_batches
for each row
execute function public.touch_planner_execution_updated_at();

revoke execute on function public.touch_planner_execution_updated_at() from public, anon, authenticated;
revoke execute on function public.enforce_planner_execution_version() from public, anon, authenticated;
