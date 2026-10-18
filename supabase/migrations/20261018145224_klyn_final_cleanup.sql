BEGIN;

-- Guard against accidentally dropping a table that gained data after inspection.
LOCK TABLE public.test123 IN ACCESS EXCLUSIVE MODE;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.test123 LIMIT 1) THEN
    RAISE EXCEPTION 'Refusing to drop public.test123 because it is no longer empty';
  END IF;
END;
$guard$;

-- No dependent objects are dropped implicitly; DROP fails if a dependency exists.
DROP TABLE public.test123;

-- These two index pairs were verified byte-for-byte equivalent in indexed columns/order.
DROP INDEX public.idx_support_tickets_user;
DROP INDEX public.user_roles_super_admin_lookup;

-- This is an application-defined SECURITY DEFINER wrapper, not the uuid-ossp extension
-- entry point; no column default depends on it. Client code can use gen_random_uuid().
ALTER FUNCTION public.uuid_generate_v4()
  SET search_path = public, pg_temp;

REVOKE ALL PRIVILEGES ON FUNCTION public.uuid_generate_v4()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.uuid_generate_v4()
  TO service_role;

COMMIT;
