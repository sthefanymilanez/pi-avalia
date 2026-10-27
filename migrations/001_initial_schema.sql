CREATE TABLE professors (
  id UUID PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES professors(id) ON DELETE RESTRICT,
  title VARCHAR(180) NOT NULL,
  course VARCHAR(180) NOT NULL DEFAULT '',
  class_name VARCHAR(120) NOT NULL DEFAULT '',
  team TEXT NOT NULL DEFAULT '',
  scale SMALLINT NOT NULL CHECK (scale IN (1, 10)),
  sheet_version INTEGER NOT NULL DEFAULT 1 CHECK (sheet_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX projects_owner_created_idx ON projects (owner_id, created_at DESC);

CREATE TABLE evaluations (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  evaluator_id UUID NOT NULL REFERENCES professors(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL CHECK (status IN ('rascunho', 'em_andamento', 'enviada')),
  scores JSONB NOT NULL CHECK (jsonb_typeof(scores) = 'array' AND jsonb_array_length(scores) = 10),
  criterion_notes JSONB NOT NULL CHECK (jsonb_typeof(criterion_notes) = 'array' AND jsonb_array_length(criterion_notes) = 10),
  comments TEXT NOT NULL DEFAULT '',
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, evaluator_id)
);
CREATE INDEX evaluations_project_status_idx ON evaluations (project_id, status);

CREATE TABLE sessions (
  token_hash CHAR(64) PRIMARY KEY,
  professor_id UUID NOT NULL REFERENCES professors(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);
