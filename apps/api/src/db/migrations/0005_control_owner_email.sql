-- A due date and an owner's email address, on the control itself.
--
-- Both could have gone into the `attrs` JSON column, which is where
-- product-specific fields live and which needs no migration. They are real
-- columns instead, for two different reasons.
--
-- The due date is read by a job that runs every day and asks "what is overdue,
-- and who owns it". That is a range scan over every control, and `json_extract`
-- in a WHERE clause cannot use an ordinary index. A column can.
--
-- The email address is a real column because it is not framework-specific.
-- Every product in this codebase has controls that somebody owns, and every one
-- of them would eventually want to tell that person something. Putting it in
-- `attrs` would have made it look like an Ascend detail when it is not.
--
-- Both are nullable and empty by default. A control with no owner and no date
-- is the normal state on a fresh install, and nothing chases anybody until
-- somebody fills these in.

alter table controls add column due_date text;
alter table controls add column owner_email text;

-- The reminder job asks for controls with a date that has passed or is close,
-- which is exactly what this index answers. Partial, because most controls will
-- never carry a date and there is no point indexing the nulls.
create index if not exists idx_controls_due_date
  on controls (due_date) where due_date is not null;
