-- RIWI tables are accessed only through FastAPI server authorization.
-- Deny direct Data API access; the table owner/server role retains access.
ALTER TABLE public."riwi_action_confirmations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_action_confirmations" FROM PUBLIC;
ALTER TABLE public."riwi_conversation_messages" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_conversation_messages" FROM PUBLIC;
ALTER TABLE public."riwi_conversations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_conversations" FROM PUBLIC;
ALTER TABLE public."riwi_knowledge_conflicts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_knowledge_conflicts" FROM PUBLIC;
ALTER TABLE public."riwi_knowledge_sources" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_knowledge_sources" FROM PUBLIC;
ALTER TABLE public."riwi_knowledge_units" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_knowledge_units" FROM PUBLIC;
ALTER TABLE public."riwi_learning_reviews" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_learning_reviews" FROM PUBLIC;
ALTER TABLE public."riwi_learning_signals" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_learning_signals" FROM PUBLIC;
ALTER TABLE public."riwi_provider_experiment_results" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_provider_experiment_results" FROM PUBLIC;
ALTER TABLE public."riwi_provider_experiments" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_provider_experiments" FROM PUBLIC;
ALTER TABLE public."riwi_usage_metrics" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_usage_metrics" FROM PUBLIC;
ALTER TABLE public."riwi_assessment_policies" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_assessment_policies" FROM PUBLIC;
ALTER TABLE public."riwi_assessment_policy_versions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_assessment_policy_versions" FROM PUBLIC;
ALTER TABLE public."riwi_security_signals" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_security_signals" FROM PUBLIC;
ALTER TABLE public."speaking_ai_sessions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."speaking_ai_sessions" FROM PUBLIC;
ALTER TABLE public."speaking_ai_session_items" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."speaking_ai_session_items" FROM PUBLIC;
DO $guard$
DECLARE role_name text; table_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      FOREACH table_name IN ARRAY ARRAY['riwi_action_confirmations','riwi_conversation_messages','riwi_conversations','riwi_knowledge_conflicts','riwi_knowledge_sources','riwi_knowledge_units','riwi_learning_reviews','riwi_learning_signals','riwi_provider_experiment_results','riwi_provider_experiments','riwi_usage_metrics','riwi_assessment_policies','riwi_assessment_policy_versions','riwi_security_signals','speaking_ai_sessions','speaking_ai_session_items'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END
$guard$;
