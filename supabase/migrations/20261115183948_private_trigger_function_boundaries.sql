-- Pin private trigger lookups and remove direct API execution. This changes no
-- business rows or trigger behavior. Apply the Academy release first.
DO $boundaries$
DECLARE
    function_name text;
    api_role text;
BEGIN
    FOREACH function_name IN ARRAY ARRAY[
        'preserve_grammar_source_owner',
        'dictionary_immutable_registry',
        'dictionary_immutable_release',
        'finance_journal_balance_guard',
        'finance_journal_immutable_guard',
        'tuition_contracts_freeze_terms'
    ] LOOP
        IF to_regprocedure(format('public.%I()', function_name)) IS NOT NULL THEN
            -- Explicit pg_temp last prevents implicit temporary-table shadowing.
            EXECUTE format('ALTER FUNCTION public.%I() SET search_path TO pg_catalog, public, pg_temp', function_name);
        END IF;
    END LOOP;
    FOREACH function_name IN ARRAY ARRAY[
        'preserve_grammar_source_owner',
        'dictionary_immutable_registry',
        'dictionary_immutable_release',
        'finance_journal_balance_guard',
        'finance_journal_immutable_guard',
        'tuition_contracts_freeze_terms',
        'rls_auto_enable'
    ] LOOP
        IF to_regprocedure(format('public.%I()', function_name)) IS NOT NULL THEN
            EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I() FROM PUBLIC', function_name);
            FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
                IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
                    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I() FROM %I', function_name, api_role);
                END IF;
            END LOOP;
        END IF;
    END LOOP;
END;
$boundaries$;
