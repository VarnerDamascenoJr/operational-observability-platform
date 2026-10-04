CREATE INDEX IF NOT EXISTS idx_incidents_list_order
  ON control_plane.incidents (detected_at DESC, created_at DESC, id DESC);

COMMENT ON INDEX control_plane.idx_incidents_list_order IS
  'Supports keyset pagination for incident listings ordered by newest detection time';
