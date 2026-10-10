-- Temporary passwords, for an administrator who has forgotten theirs.
--
-- "Forgot password?" on the sign-in page emails an administrator a temporary
-- password. It is kept here, hashed, never in the users table, for three
-- reasons:
--
--  - The real password keeps working until the temporary one is used. Anybody
--    can type an administrator's username into the form, and if that replaced
--    the password it would lock the real administrator out on demand.
--  - It works once and for thirty minutes, which needs somewhere to record
--    when it was issued and whether it has been spent.
--  - Asking again replaces the previous one, so only the newest email works.
--
-- Signing in with one marks the session, and a marked session can do nothing
-- but choose a new password.

create table password_resets (
  id            text primary key,
  user_id       text not null references users(id) on delete cascade,
  password_hash text not null,                 -- argon2id of the temporary password
  expires_at    text not null,
  used_at       text,                          -- set when it signs somebody in, or is replaced
  requested_ip  text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index password_resets_user_idx on password_resets (user_id, used_at, expires_at);

alter table sessions add column must_change_password integer not null default 0;
