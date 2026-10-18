BEGIN;

-- 1. Restrict public.bugs to service_role at both RLS-policy and SQL-grant layers.
DROP POLICY IF EXISTS "Allow service role full access" ON public.bugs;
DROP POLICY IF EXISTS bugs_service_role_all ON public.bugs;
REVOKE ALL PRIVILEGES ON TABLE public.bugs FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.bugs TO service_role;
CREATE POLICY bugs_service_role_all
  ON public.bugs
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Lock down the four SECURITY DEFINER entry points. Keep paths explicit.
ALTER FUNCTION public.get_user_org_ids()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.has_role(public.user_role)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_messages_used(uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.reset_monthly_usage()
  SET search_path = public, pg_temp;

REVOKE ALL PRIVILEGES ON FUNCTION public.get_user_org_ids() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.has_role(public.user_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.increment_messages_used(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.reset_monthly_usage() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_user_org_ids() TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(public.user_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_messages_used(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_monthly_usage() TO service_role;

-- 3. A non-exposed helper preserves owner-scoped RLS checks after the public
-- get_user_org_ids() RPC is restricted. It derives scope only from auth.uid().
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL PRIVILEGES ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.klyn_current_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT tm.org_id
  FROM public.team_members AS tm
  WHERE tm.user_id = auth.uid();
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION private.klyn_current_user_org_ids() FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION private.klyn_current_user_org_ids() FROM authenticated;
GRANT EXECUTE ON FUNCTION private.klyn_current_user_org_ids() TO authenticated;

-- Update team_members policies to use the non-exposed, caller-scoped helper.
-- The predicates preserve the pre-existing org-membership model while removing
-- dependencies on a client-executable public SECURITY DEFINER function.
DROP POLICY IF EXISTS team_members_select ON public.team_members;
DROP POLICY IF EXISTS team_members_insert ON public.team_members;
DROP POLICY IF EXISTS team_members_update ON public.team_members;
DROP POLICY IF EXISTS team_members_delete ON public.team_members;
CREATE POLICY team_members_select
  ON public.team_members FOR SELECT TO authenticated
  USING (org_id IN (SELECT private.klyn_current_user_org_ids()));
CREATE POLICY team_members_insert
  ON public.team_members FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT private.klyn_current_user_org_ids()));
CREATE POLICY team_members_update
  ON public.team_members FOR UPDATE TO authenticated
  USING (org_id IN (SELECT private.klyn_current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT private.klyn_current_user_org_ids()));
CREATE POLICY team_members_delete
  ON public.team_members FOR DELETE TO authenticated
  USING (org_id IN (SELECT private.klyn_current_user_org_ids()));

-- 4. Consolidate projects RLS. The previous predicate selected the OUTER
-- projects.organization_id from inside a membership subquery, which did not
-- compare the project's organization to team_members.org_id.
DROP POLICY IF EXISTS organization_members_can_view_projects ON public.projects;
DROP POLICY IF EXISTS organization_projects_policy ON public.projects;
DROP POLICY IF EXISTS project_access ON public.projects;
CREATE POLICY projects_org_member_access
  ON public.projects
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (organization_id IN (SELECT private.klyn_current_user_org_ids()))
  WITH CHECK (organization_id IN (SELECT private.klyn_current_user_org_ids()));

REVOKE ALL PRIVILEGES ON TABLE public.projects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.projects TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.projects TO service_role;

-- 5. Consolidate planner state owner policies without adding DELETE capability.
DROP POLICY IF EXISTS planner_execution_states_insert_own ON public.planner_execution_states;
DROP POLICY IF EXISTS planner_execution_states_select_own ON public.planner_execution_states;
DROP POLICY IF EXISTS planner_execution_states_update_own ON public.planner_execution_states;
DROP POLICY IF EXISTS planner_execution_states_owner_access ON public.planner_execution_states;
DROP POLICY IF EXISTS planner_execution_states_deny_delete ON public.planner_execution_states;

CREATE POLICY planner_execution_states_owner_access
  ON public.planner_execution_states
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = owner_user_id)
  WITH CHECK ((SELECT auth.uid()) = owner_user_id);

-- A restrictive DELETE deny preserves the old no-delete contract despite FOR ALL.
CREATE POLICY planner_execution_states_deny_delete
  ON public.planner_execution_states
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (false);

REVOKE ALL PRIVILEGES ON TABLE public.planner_execution_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.planner_execution_states TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.planner_execution_states TO service_role;

-- 6. CAS transition. A row is changed only at the expected version. The existing
-- version guard trigger enforces exactly +1 and the timestamp trigger updates updated_at.
CREATE OR REPLACE FUNCTION public.klyn_transition_execution_state(
  p_execution_id text,
  p_task_id text,
  p_expected_state_version bigint,
  p_new_status text,
  p_new_phase integer DEFAULT NULL,
  p_new_node jsonb DEFAULT NULL,
  p_completed_prerequisites jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS public.planner_execution_states
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_state public.planner_execution_states%ROWTYPE;
  v_current_version bigint;
BEGIN
  IF p_execution_id IS NULL OR p_task_id IS NULL THEN
    RAISE EXCEPTION 'execution_id and task_id are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_expected_state_version IS NULL OR p_expected_state_version < 1 THEN
    RAISE EXCEPTION 'expected state version must be >= 1'
      USING ERRCODE = '22023';
  END IF;

  IF p_new_status IS NULL OR p_new_status NOT IN ('pending','queued','executing','completed','failed') THEN
    RAISE EXCEPTION 'unsupported execution status: %', p_new_status
      USING ERRCODE = '22023';
  END IF;

  IF p_new_phase IS NOT NULL AND p_new_phase < 1 THEN
    RAISE EXCEPTION 'phase must be >= 1'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.planner_execution_states AS s
  SET status = p_new_status,
      phase = COALESCE(p_new_phase, s.phase),
      node = COALESCE(p_new_node, s.node),
      completed_prerequisites = COALESCE(p_completed_prerequisites, s.completed_prerequisites),
      metadata = COALESCE(p_metadata, s.metadata),
      state_version = s.state_version + 1
  WHERE s.execution_id = p_execution_id
    AND s.task_id = p_task_id
    AND s.state_version = p_expected_state_version
  RETURNING s.* INTO v_state;

  IF NOT FOUND THEN
    SELECT s.state_version
      INTO v_current_version
    FROM public.planner_execution_states AS s
    WHERE s.execution_id = p_execution_id
      AND s.task_id = p_task_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'planner execution state not found'
        USING ERRCODE = 'P0002';
    END IF;

    RAISE EXCEPTION 'stale planner state version: expected %, current %',
      p_expected_state_version, v_current_version
      USING ERRCODE = '40001',
            DETAIL = 'Reload the current state and retry the transition with its current state_version.';
  END IF;

  RETURN v_state;
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.klyn_transition_execution_state(text,text,bigint,text,integer,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.klyn_transition_execution_state(text,text,bigint,text,integer,jsonb,jsonb,jsonb)
  TO service_role;

COMMENT ON FUNCTION public.klyn_transition_execution_state(text,text,bigint,text,integer,jsonb,jsonb,jsonb)
  IS 'Atomically transitions one planner execution row using execution_id/task_id and expected state_version CAS. Raises SQLSTATE 40001 on stale versions. service_role only.';

COMMIT;
