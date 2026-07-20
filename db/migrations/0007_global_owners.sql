-- Global owners materialized from STAFF_EMAILS on login. Lets email-authorized
-- owners get full cross-project owner powers (see/administer every project)
-- without collecting Clerk user ids by hand. Reconciled on each /api/me login:
-- inserted when the user's verified email is in STAFF_EMAILS, removed when not.
create table if not exists global_owners (
  user_id text primary key,
  email text not null,
  created_at timestamptz not null default now()
);
