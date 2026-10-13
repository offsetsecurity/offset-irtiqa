-- Who a one-time password is for: a forgotten password, or a new person.
--
-- A new person can be invited instead of being given a password. The
-- administrator never sees one: the product makes a one-time password, emails
-- it, and the person chooses their own on first sign-in. That is the same
-- mechanism as "Forgot password?" - single use, only opens the page that
-- chooses a new password - so it lives in the same table.
--
-- The two differ in who may use them and for how long, so a row says which it
-- is. A reset only works for an administrator and lasts thirty minutes; an
-- invitation works for anybody and lasts three days, because a new person may
-- not read their mail the same day.
alter table password_resets add column kind text not null default 'reset'
  check (kind in ('reset', 'invite'));
