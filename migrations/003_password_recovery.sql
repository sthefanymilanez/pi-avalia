CREATE TABLE password_reset_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  professor_id UUID NOT NULL REFERENCES professors(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_owner_idx ON password_reset_tokens (professor_id, created_at DESC);
CREATE INDEX password_reset_tokens_expiry_idx ON password_reset_tokens (expires_at) WHERE used_at IS NULL;
