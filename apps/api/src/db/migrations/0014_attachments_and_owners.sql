-- Files on any register, and somebody to remind on each.
--
-- Evidence was the only place a file could be attached. An auditor asking for
-- the signed supplier contract, the management review minutes or the training
-- completion export had to be pointed at a separate evidence item and told to
-- trust the link. Now the file sits on the record it proves.
--
-- One table for every register rather than a column per table: a record can
-- hold several files, and every register gets the same behaviour from one
-- place. The files themselves live in the same store as evidence documents,
-- and backups and restores carry them the same way.
create table attachments (
  id          text primary key,
  entity      text not null,      -- the register's table name: policies, vendors, ...
  entity_id   text not null,
  file_key    text not null,
  file_name   text not null,
  file_size   integer not null,
  file_sha256 text not null,
  uploaded_by text not null default '',
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index attachments_entity_idx on attachments (entity, entity_id);

-- Every one of these already had a date that matters - a review date, the next
-- training due, an objective's deadline, a planned audit - and an owner's name,
-- but no address, so nothing could chase the owner when the date came.
alter table policies       add column owner_email text not null default '';
alter table vendors        add column owner_email text not null default '';
alter table training       add column owner_email text not null default '';
alter table objectives     add column owner_email text not null default '';
alter table parties        add column owner_email text not null default '';
alter table reviews        add column owner_email text not null default '';
alter table communications add column owner_email text not null default '';

-- Interested parties had no date at all. Their requirements change, and 9.3
-- asks for those changes at every management review.
alter table parties add column review_date text;
