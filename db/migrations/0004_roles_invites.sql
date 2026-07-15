-- Roles v2: per-project member roles are admin/editor/reader (was owner/editor/reader).
-- "Owner" is now a GLOBAL role (space creation) carried by STAFF_USER_IDS, not a
-- per-project member role. space_members is empty at this point (fresh start), so
-- swapping the CHECK is safe.
alter table space_members drop constraint if exists space_members_role_check;
alter table space_members add constraint space_members_role_check check (role in ('admin', 'editor', 'reader'));

-- Email invitations pending acceptance. On sign-up/login we reconcile a user's
-- verified email against these and materialize the membership.
create table if not exists pending_invitations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'editor', 'reader')),
  invited_by text not null,
  clerk_invitation_id text,
  created_at timestamptz not null default now(),
  unique (space_id, email)
);
create index if not exists pending_invitations_email_idx on pending_invitations (lower(email));
