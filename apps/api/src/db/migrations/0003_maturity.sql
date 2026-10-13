-- Maturity scoring, for frameworks that rate rather than tick.
--
-- The four statuses — Not Started, In Progress, Implemented, Not Applicable —
-- answer "have you done it". SAMA asks a different question: "how well, on a
-- scale of nought to five", and a member organisation submits one level per
-- subdomain. A tick box cannot carry that answer.
--
-- Two columns rather than a separate table. Maturity is one number about one
-- control, it is read on every list and every dashboard figure, and a join
-- would buy nothing. Both are nullable: products that do not score maturity
-- leave them alone entirely, and the existing status column is untouched for
-- the frameworks that use it.
--
-- No CHECK on the range here. The API validates 0-5, and a constraint in the
-- database would make a future framework with a different scale a migration
-- rather than a pack.

alter table controls add column maturity integer;
alter table controls add column target_maturity integer;

-- Readiness is computed across every control on every dashboard load, and the
-- maturity figures filter on these. Cheap to add now, awkward to add later.
create index if not exists idx_controls_maturity on controls (maturity);
