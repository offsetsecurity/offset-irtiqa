-- Two registers were left without the JSON escape hatch every other one has.
--
-- `risks` and `evidence` predate the pattern, so anything that needs to mark a
-- row - the example data marks its own, so that removing the examples cannot
-- touch real work - had nowhere to write. Rather than teach one feature to keep
-- a list of ids somewhere else, the two tables get the column the rest already
-- have.
--
-- Its own migration rather than an edit to 0009, because 0009 has already run
-- on installs: a migration that has been applied is history, and editing
-- history means the column never appears on the machines that ran it.

alter table risks add column attrs text not null default '{}';
alter table evidence add column attrs text not null default '{}';
