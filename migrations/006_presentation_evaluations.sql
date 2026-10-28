CREATE TABLE presentation_evaluations (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  evaluator_id UUID NOT NULL REFERENCES professors(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL CHECK (status IN ('rascunho', 'enviada')),
  scores JSONB NOT NULL CHECK (jsonb_typeof(scores) = 'array' AND jsonb_array_length(scores) = 3),
  criterion_notes JSONB NOT NULL CHECK (jsonb_typeof(criterion_notes) = 'array' AND jsonb_array_length(criterion_notes) = 3),
  comments TEXT NOT NULL DEFAULT '',
  result NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, evaluator_id)
);
CREATE INDEX presentation_evaluations_project_status_idx ON presentation_evaluations (project_id, status);
