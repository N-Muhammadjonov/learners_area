-- Typing duration presets (1/2/3 minutes). Additive and nullable:
-- NULL = untimed full-text run, including every run recorded before presets existed
-- (old runs are not back-filled with an invented preset).
ALTER TABLE typing_run_texts ADD COLUMN preset_seconds smallint
  CHECK (preset_seconds IS NULL OR preset_seconds IN (60, 120, 180));
