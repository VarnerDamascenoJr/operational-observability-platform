ALTER TABLE control_plane.sli_evaluation_windows
  ADD COLUMN source_kind text NOT NULL DEFAULT 'manual',
  ADD COLUMN source_query text,
  ADD COLUMN source_period text,
  ADD CONSTRAINT sli_evaluation_windows_source_kind
    CHECK (source_kind IN ('manual', 'fixture', 'prometheus'));

COMMENT ON COLUMN control_plane.sli_evaluation_windows.source_kind IS
  'Origin of the counts used to evaluate the SLI window';

COMMENT ON COLUMN control_plane.sli_evaluation_windows.source_query IS
  'Query, fixture path or reproducible reference that produced the counts';

COMMENT ON COLUMN control_plane.sli_evaluation_windows.source_period IS
  'Human-readable source period or cadence used to build the evaluation window';
