-- Somewhere to write about evidence that is going stale.
--
-- Evidence already carries an owner's name and a next review date. The date was
-- only ever shown on screen as a colour, so a piece of proof could pass its
-- review and sit there for a year with nobody told. Adding an address makes the
-- date mean something: the person who owns the proof is the person who has to
-- refresh it.
--
-- This is the fourth and last thing in the product that can be chased. Controls,
-- tasks, readiness-plan steps and now evidence all carry the same pair - a date
-- and an address - and the reminder job asks the same question of each.
--
-- Nullable and empty by default, so nothing is chased until somebody fills it
-- in. An install that starts emailing people on its own is an install that gets
-- switched off.

alter table evidence add column owner_email text;

-- The reminder job scans for review dates that have arrived. Partial, because
-- most evidence will never carry an address and indexing the nulls buys nothing.
create index if not exists idx_evidence_due_owner
  on evidence (next_review) where owner_email is not null and owner_email <> '';
