CREATE TABLE normalization_profiles (
  id UUID PRIMARY KEY,
  professor_id UUID NOT NULL REFERENCES professors(id) ON DELETE CASCADE,
  name VARCHAR(180) NOT NULL,
  norm_code VARCHAR(40) NOT NULL,
  edition VARCHAR(30) NOT NULL,
  effective_year SMALLINT NOT NULL CHECK (effective_year BETWEEN 1950 AND 2200),
  source_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (professor_id, name, effective_year)
);
CREATE INDEX normalization_profiles_owner_year_idx ON normalization_profiles (professor_id, effective_year DESC);

CREATE TABLE document_analyses (
  id UUID PRIMARY KEY,
  professor_id UUID NOT NULL REFERENCES professors(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  filename VARCHAR(255) NOT NULL,
  profile_snapshot JSONB NOT NULL,
  report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_analyses_owner_created_idx ON document_analyses (professor_id, created_at DESC);
