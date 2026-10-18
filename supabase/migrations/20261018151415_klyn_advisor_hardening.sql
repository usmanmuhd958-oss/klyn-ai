
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

-- ---------------------------------------------------------------------------
-- 1. Hardening custom public functions that Supabase's current advisor reports
--    as having a mutable search_path. Other public trigger helpers already
--    explicitly pin search_path to pg_catalog, public; those are retained.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.audit_trigger()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.create_trial_subscription()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_updated_at()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at()
  SET search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 2. Consolidate known duplicate permissive policies while preserving the
--    existing owner/self/organization authorization predicates. Auth-dependent
--    policies are explicitly restricted to authenticated callers.
-- ---------------------------------------------------------------------------

-- analytics: SELECT was owner OR self across two permissive policies.
DROP POLICY IF EXISTS analytics_select_org_owner ON public.analytics;
DROP POLICY IF EXISTS analytics_select_own ON public.analytics;
CREATE POLICY analytics_select_owner_or_self
  ON public.analytics AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.organizations AS o
      WHERE o.id = analytics.organization_id
        AND o.owner_id = (SELECT auth.uid())
    )
  );

-- api_keys: SELECT was self OR organization owner.
DROP POLICY IF EXISTS api_keys_select_own ON public.api_keys;
DROP POLICY IF EXISTS apikey_select_org_owner ON public.api_keys;
CREATE POLICY api_keys_select_owner_or_self
  ON public.api_keys AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.organizations AS o
      WHERE o.id = api_keys.organization_id
        AND o.owner_id = (SELECT auth.uid())
    )
  );

-- notifications: the previous SELECT policies were duplicates.
DROP POLICY IF EXISTS notif_select_own ON public.notifications;
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own
  ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- organizations: overlapping PUBLIC/authenticated policies plus an ALL policy
-- reduced to one owner-checked policy per operation.
DROP POLICY IF EXISTS org_delete_owner ON public.organizations;
DROP POLICY IF EXISTS org_insert_owner ON public.organizations;
DROP POLICY IF EXISTS org_select_owner ON public.organizations;
DROP POLICY IF EXISTS org_update_owner ON public.organizations;
DROP POLICY IF EXISTS organizations_delete ON public.organizations;
DROP POLICY IF EXISTS organizations_insert ON public.organizations;
DROP POLICY IF EXISTS organizations_owner_all ON public.organizations;
DROP POLICY IF EXISTS organizations_select ON public.organizations;
DROP POLICY IF EXISTS organizations_update ON public.organizations;

CREATE POLICY organizations_select_owner
  ON public.organizations AS PERMISSIVE FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
CREATE POLICY organizations_insert_owner
  ON public.organizations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY organizations_update_owner
  ON public.organizations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY organizations_delete_owner
  ON public.organizations AS PERMISSIVE FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- payments: SELECT was organization owner OR self.
DROP POLICY IF EXISTS payment_select_org_owner ON public.payments;
DROP POLICY IF EXISTS payments_select_own ON public.payments;
CREATE POLICY payments_select_owner_or_self
  ON public.payments AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.organizations AS o
      WHERE o.id = payments.organization_id
        AND o.owner_id = (SELECT auth.uid())
    )
  );

-- support_tickets: SELECT was self OR (self OR organization owner).
DROP POLICY IF EXISTS support_select_own ON public.support_tickets;
DROP POLICY IF EXISTS ticket_select_own_or_org ON public.support_tickets;
CREATE POLICY ticket_select_own_or_org
  ON public.support_tickets AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.organizations AS o
      WHERE o.id = support_tickets.organization_id
        AND o.owner_id = (SELECT auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Rewrite direct auth.* calls in remaining public RLS policies as scalar
--    subqueries. This allows per-statement initPlan evaluation. PUBLIC policies
--    that depend on auth context are narrowed to authenticated, since those
--    predicates already fail closed for anonymous callers.
--    Existing explicit scalar-subquery auth calls are left unchanged.
-- ---------------------------------------------------------------------------
DO $rls_optimize$
DECLARE
  p RECORD;
  v_using text;
  v_check text;
  v_roles_sql text;
  v_uses_auth boolean;
  v_sql text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        coalesce(qual, '') ~* 'auth\.(uid|jwt|role|email|phone)\s*\('
        OR coalesce(with_check, '') ~* 'auth\.(uid|jwt|role|email|phone)\s*\('
      )
  LOOP
    v_using := p.qual;
    v_check := p.with_check;
    v_uses_auth := true;

    IF v_using IS NOT NULL
       AND v_using ~* 'auth\.(uid|jwt|role|email|phone)\s*\('
       AND position('SELECT AUTH.UID()' in upper(v_using)) = 0
       AND position('SELECT AUTH.JWT()' in upper(v_using)) = 0
       AND position('SELECT AUTH.ROLE()' in upper(v_using)) = 0
       AND position('SELECT AUTH.EMAIL()' in upper(v_using)) = 0
       AND position('SELECT AUTH.PHONE()' in upper(v_using)) = 0
    THEN
      v_using := replace(v_using, 'auth.uid()', '(SELECT auth.uid())');
      v_using := replace(v_using, 'auth.jwt()', '(SELECT auth.jwt())');
      v_using := replace(v_using, 'auth.role()', '(SELECT auth.role())');
      v_using := replace(v_using, 'auth.email()', '(SELECT auth.email())');
      v_using := replace(v_using, 'auth.phone()', '(SELECT auth.phone())');
    END IF;

    IF v_check IS NOT NULL
       AND v_check ~* 'auth\.(uid|jwt|role|email|phone)\s*\('
       AND position('SELECT AUTH.UID()' in upper(v_check)) = 0
       AND position('SELECT AUTH.JWT()' in upper(v_check)) = 0
       AND position('SELECT AUTH.ROLE()' in upper(v_check)) = 0
       AND position('SELECT AUTH.EMAIL()' in upper(v_check)) = 0
       AND position('SELECT AUTH.PHONE()' in upper(v_check)) = 0
    THEN
      v_check := replace(v_check, 'auth.uid()', '(SELECT auth.uid())');
      v_check := replace(v_check, 'auth.jwt()', '(SELECT auth.jwt())');
      v_check := replace(v_check, 'auth.role()', '(SELECT auth.role())');
      v_check := replace(v_check, 'auth.email()', '(SELECT auth.email())');
      v_check := replace(v_check, 'auth.phone()', '(SELECT auth.phone())');
    END IF;

    IF p.roles = ARRAY['public']::name[] THEN
      v_roles_sql := 'authenticated';
    ELSE
      SELECT string_agg(
        CASE WHEN r::text = 'public' THEN 'PUBLIC' ELSE quote_ident(r::text) END,
        ', ' ORDER BY ord
      )
      INTO v_roles_sql
      FROM unnest(p.roles) WITH ORDINALITY AS roles(r, ord);
    END IF;

    EXECUTE format('DROP POLICY %I ON %I.%I',
                   p.policyname, p.schemaname, p.tablename);

    v_sql := format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
      p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd, v_roles_sql
    );
    IF v_using IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', v_using);
    END IF;
    IF v_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', v_check);
    END IF;
    EXECUTE v_sql;
  END LOOP;
END;
$rls_optimize$;

-- ---------------------------------------------------------------------------
-- 4. Explicit fail-closed policies for public base tables that have RLS enabled
--    but no policies. This preserves the existing no-client-access behavior
--    for anon/authenticated while making the intended denial explicit and
--    resilient to future permissive-policy additions.
-- ---------------------------------------------------------------------------
DO $rls_coverage$
DECLARE
  t RECORD;
  v_policy_name text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1 FROM pg_policy pol WHERE pol.polrelid = c.oid
      )
    ORDER BY c.relname
  LOOP
    v_policy_name :=
      left('klyn_deny_clients_' || t.relname, 48) || '_' ||
      substr(md5(t.relname), 1, 10);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      v_policy_name, t.relname
    );
  END LOOP;
END;
$rls_coverage$;

-- ---------------------------------------------------------------------------
-- 5. B-tree indexes for public-schema foreign keys lacking a valid, non-partial
--    left-prefix index in FK column order. Names include a deterministic hash.
-- ---------------------------------------------------------------------------
DO $fk_indexing$
DECLARE
  fk RECORD;
  v_cols text;
  v_index_name text;
BEGIN
  FOR fk IN
    SELECT con.oid AS constraint_oid,
           con.conname,
           con.conrelid,
           con.conkey,
           c.relname AS table_name
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.contype = 'f'
      AND con.convalidated
      AND n.nspname = 'public'
    ORDER BY c.relname, con.conname
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = fk.conrelid
        AND i.indisvalid
        AND i.indisready
        AND i.indpred IS NULL
        AND i.indnkeyatts >= cardinality(fk.conkey)
        AND (
          SELECT array_agg(k.attnum ORDER BY k.ord)
          FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum, ord)
          WHERE k.ord <= cardinality(fk.conkey)
        ) = fk.conkey
    ) THEN
      SELECT string_agg(format('%I', a.attname), ', ' ORDER BY k.ord)
      INTO v_cols
      FROM unnest(fk.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a
        ON a.attrelid = fk.conrelid
       AND a.attnum = k.attnum;

      v_index_name :=
        left('klyn_fk_' || fk.table_name || '_' || fk.conname, 48) || '_' ||
        substr(md5(fk.conrelid::text || ':' || fk.conname), 1, 10);

      EXECUTE format(
        'CREATE INDEX %I ON public.%I USING btree (%s)',
        v_index_name, fk.table_name, v_cols
      );
    END IF;
  END LOOP;
END;
$fk_indexing$;

-- ---------------------------------------------------------------------------
-- 6. Relocate the relocatable pgvector extension from public to extensions.
--    The preflight audit found no table columns typed as vector, so the move
--    will not change a table column's declared type.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;
DO $vector_schema$
DECLARE
  v_schema text;
  v_relocatable boolean;
BEGIN
  SELECT n.nspname, e.extrelocatable
    INTO v_schema, v_relocatable
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'vector';

  IF FOUND AND v_schema = 'public' THEN
    IF NOT v_relocatable THEN
      RAISE EXCEPTION 'vector extension is not relocatable; refusing schema move';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_attribute a
      JOIN pg_type t ON t.oid = a.atttypid
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE a.attnum > 0
        AND NOT a.attisdropped
        AND t.typname = 'vector'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ) THEN
      RAISE EXCEPTION 'vector-typed table columns exist; review dependent application objects before moving extension';
    END IF;

    ALTER EXTENSION vector SET SCHEMA extensions;
  END IF;
END;
$vector_schema$;

COMMIT;
