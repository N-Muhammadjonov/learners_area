# 03 — Database Schema & Migration Collision Analysis

## 1. Ordinal Collision Inventory (`0036`–`0050`)

Both `LEGACY_RIWI` (`arena/01a10bac-learners-area`) and `CURRENT_SITE` (`arena/learners-area-next`) share identical migrations `0000_ambitious_Echo.sql` through `0035_speaking_attempts_audio_object_key.sql`. Starting at ordinal `0036`, the two branches diverged:

| Ordinal | `LEGACY_RIWI` Migration File | `CURRENT_SITE` Migration File (Preserved Untouched) |
|---|---|---|
| `0036` | `0036_riwi_core_foundation.sql` | `0036_speaking_study_support.sql` |
| `0037` | `0037_riwi_knowledge_source_upload_key.sql` | `0037_reading_question_group_shared_context.sql` |
| `0038` | `0038_riwi_audit_usage_provider_lab.sql` | `0038_reading_question_layout_metadata.sql` |
| `0039` | `0039_riwi_knowledge_source_checksum.sql` | `0039_listening_question_types_expansion.sql` |
| `0040` | `0040_riwi_learning_signal_unique_source.sql` | `0040_listening_study_support.sql` |
| `0041` | `0041_riwi_provider_experiment_unique_idempotency.sql` | `0041_listening_mcq_lab.sql` |
| `0042` | `0042_riwi_conversation_message_correlation.sql` | `0042_listening_section_exams.sql` |
| `0043` | `0043_riwi_conversation_message_report_snapshot.sql` | `0043_vocabulary_workspace_overhaul.sql` |
| `0044` | `0044_riwi_learning_review_resulting_source.sql` | `0044_reading_retention_engine.sql` |
| `0045` | `0045_riwi_conversation_retention_hardening.sql` | `0045_live_speaking_partner.sql` |
| `0046` | `0046_riwi_assessment_contracts_and_owner_policy.sql` | `0046_listening_package_builder_and_activities.sql` |
| `0047` | `0047_speaking_ai_sessions_fenced.sql` | `0047_general_reading_ielts_5_5_foundation.sql` |
| `0048` | `0048_riwi_owner_history_pagination_indexes.sql` | `0048_writing_system_overhaul.sql` |
| `0049` | `0049_riwi_security_signals.sql` | `0049_writing_translation_and_stealing.sql` |
| `0050` | `0050_riwi_activity_events_last_seen_index.sql` | `0050_lesson_learning_area.sql` |

`CURRENT_SITE` then continues with `0051_lesson_author_workspace.sql` through `0069_video_progress_playback_duration.sql`.

## 2. Forward-Only Resolution Strategy (`0070`–`0072`)

To preserve all 70 existing migrations (`0000`–`0069`) on `CURRENT_SITE` without destructive renumbering or data loss, all `LEGACY_RIWI` schema additions are consolidated into three forward-only, idempotent PostgreSQL migrations appended after `0069_video_progress_playback_duration.sql`:

1. **`0070_riwi_core_and_governance.sql`** (consolidates `LEGACY_RIWI` `0036`–`0045`, `0048`):
   - Adds `"riwi_knowledge_source"` to `upload_purpose` enum (`ALTER TYPE ... ADD VALUE IF NOT EXISTS`).
   - Creates RIWI enums (`riwi_knowledge_source_type`, `riwi_knowledge_rights_class`, `riwi_knowledge_scope`, `riwi_knowledge_state`, `riwi_conflict_state`, `riwi_learning_signal_type`, `riwi_learning_signal_state`, `riwi_review_decision`, `riwi_provider_experiment_state`) with `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` guards.
   - Creates `riwi_knowledge_sources`, `riwi_knowledge_units` (with generated full-text `search_vector` and GIN index), `riwi_knowledge_conflicts`, `riwi_learning_signals`, `riwi_learning_reviews`, `riwi_conversations`, `riwi_conversation_messages` (including `correlation_id`, `report_snapshot`, and `riwi_conversation_messages_Append_only` trigger), `riwi_action_confirmations`, `riwi_provider_experiments`, `riwi_provider_experiment_results`, and `riwi_usage_metrics`.
   - Creates all uniqueness, foreign-key, check, and owner-history cursor pagination indexes.

2. **`0071_riwi_assessments_and_security_signals.sql`** (consolidates `LEGACY_RIWI` `0046`, `0049`):
   - Adds `assessment_contract_key`, `assessment_policy_scope`, `assessment_policy_version`, and `teaching_feedback` to `evaluations` (`ADD COLUMN IF NOT EXISTS`).
   - Creates `riwi_assessment_policy_state` and `riwi_security_signal_state` enums.
   - Creates `riwi_assessment_policies`, `riwi_assessment_policy_versions` (with append-only trigger preventing mutation of approved versions), and `riwi_security_signals` (with check constraints forbidding raw prompt/payload keys).

3. **`0072_riwi_speaking_sessions_and_activity_indexes.sql`** (consolidates `LEGACY_RIWI` `0047`, `0050`):
   - Creates `speaking_ai_sessions` and `speaking_ai_session_items` with composite foreign keys and check constraints.
   - Creates `activity_events_user_created_idx` on `activity_events (user_id, created_at DESC)` to support D-01 online activity resolution in `riwi_retention.py` and `riwi_conversations.py`.
