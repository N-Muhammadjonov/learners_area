-- Maintenance command for the independently approved database scheduler.
-- Active messages expire at seven days; retired chats expire together after 30m.
-- Run every minute to reclaim expired rows while the app/browser is closed.
-- Do not install this command on Production without the Owner's separate approval.
DELETE FROM public.riwi_conversations c
WHERE c.deleted_at IS NOT NULL OR c.expires_at<=CURRENT_TIMESTAMP
   OR (NOT EXISTS(SELECT 1 FROM public.riwi_conversation_messages m
       WHERE m.conversation_id=c.id AND m.created_at>CURRENT_TIMESTAMP-interval '7 days')
       AND NOT EXISTS(SELECT 1 FROM public.riwi_conversation_messages a
         WHERE a.conversation_id=c.id AND a.metadata ? 'riwiArchivedAt'));
DELETE FROM public.riwi_conversation_messages m
WHERE created_at<=CURRENT_TIMESTAMP-interval '7 days'
  AND NOT EXISTS(SELECT 1 FROM public.riwi_conversation_messages a
    WHERE a.conversation_id=m.conversation_id AND a.metadata ? 'riwiArchivedAt');
