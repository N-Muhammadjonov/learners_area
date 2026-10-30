-- Reuse the existing in-app notification table while making event delivery
-- safe to retry. Legacy notifications without eventId are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_event_id_unique_idx
  ON notifications (user_id, ((payload ->> 'eventId')))
  WHERE payload ? 'eventId';
