-- Speaking Partner feedback uses exact IELTS half-band units: 2=1.0 ... 18=9.0.
-- Existing ratings remain valid integers and are never rewritten.
ALTER TABLE public.live_partner_feedback
  DROP CONSTRAINT IF EXISTS live_partner_feedback_check;

ALTER TABLE public.live_partner_feedback
  ADD CONSTRAINT live_partner_feedback_check CHECK (
    (kind = 'rating' AND rating IS NOT NULL AND rating BETWEEN 2 AND 18 AND reason IS NULL)
    OR (kind = 'report' AND rating IS NULL AND reason IN ('abuse', 'spam', 'other') AND reason IS NOT NULL)
  );
