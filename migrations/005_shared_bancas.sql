CREATE TABLE project_invitations (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  inviter_id UUID NOT NULL REFERENCES professors(id) ON DELETE CASCADE,
  invitee_id UUID NOT NULL REFERENCES professors(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  CHECK (inviter_id <> invitee_id)
);

CREATE UNIQUE INDEX project_invitations_active_pair_idx
  ON project_invitations (project_id, invitee_id)
  WHERE status IN ('pending', 'accepted');
CREATE INDEX project_invitations_invitee_status_idx
  ON project_invitations (invitee_id, status, created_at DESC);
CREATE INDEX project_invitations_inviter_created_idx
  ON project_invitations (inviter_id, created_at DESC);
