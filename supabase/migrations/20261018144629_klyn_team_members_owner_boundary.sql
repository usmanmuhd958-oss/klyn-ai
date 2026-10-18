
BEGIN;

CREATE OR REPLACE FUNCTION private.klyn_is_org_owner(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations AS o
    WHERE o.id = p_org_id
      AND o.owner_id = auth.uid()
  );
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION private.klyn_is_org_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION private.klyn_is_org_owner(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION private.klyn_is_org_owner(uuid) TO authenticated;

-- Organization members may read their organization's roster, but membership
-- changes and role assignments are controlled by the canonical organization owner.
DROP POLICY IF EXISTS team_members_insert ON public.team_members;
DROP POLICY IF EXISTS team_members_update ON public.team_members;
DROP POLICY IF EXISTS team_members_delete ON public.team_members;

CREATE POLICY team_members_insert
  ON public.team_members FOR INSERT TO authenticated
  WITH CHECK (private.klyn_is_org_owner(org_id));

CREATE POLICY team_members_update
  ON public.team_members FOR UPDATE TO authenticated
  USING (private.klyn_is_org_owner(org_id))
  WITH CHECK (private.klyn_is_org_owner(org_id));

CREATE POLICY team_members_delete
  ON public.team_members FOR DELETE TO authenticated
  USING (private.klyn_is_org_owner(org_id));

COMMIT;
