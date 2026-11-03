-- Maintenance command for the independently approved database scheduler.
-- App reads and the open composer enforce the exact seven-day visibility boundary.
-- Run every minute to reclaim expired rows while the app/browser is closed.
-- Do not install this command on Production without the Owner's separate approval.
DELETE FROM public.riwi_conversations c
WHERE c.deleted_at IS NOT NULL OR c.expires_at<=CURRENT_TIMESTAMP
   OR NOT EXISTS(SELECT 1 FROM public.riwi_conversation_messages m
       WHERE m.conversation_id=c.id AND m.created_at>CURRENT_TIMESTAMP-interval '7 days');
DELETE FROM public.riwi_conversation_messages
WHERE created_at<=CURRENT_TIMESTAMP-interval '7 days';
