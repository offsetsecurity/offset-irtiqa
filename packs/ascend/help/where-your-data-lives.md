# Where your data lives

## On your own server

Everything is on the machine this runs on: one database file, one folder of
evidence documents, one folder of backups. There is no cloud service behind it
and no telemetry. Nothing leaves the building unless somebody presses a button
that sends it.

## Where the files are

| | Windows | Linux | Docker |
|---|---|---|---|
| The program | `C:\Program Files\Offset Security\Offset Irtiqa` | `/opt/offset-ascend` | In the image |
| Your data | `C:\ProgramData\Offset Security\Offset Irtiqa` | `/var/lib/offset-ascend` | Four volumes: `data`, `evidence`, `backups`, `logs` |

Your data is the database, the evidence documents, the backups, the logs and a
`.env` file of settings and secrets. An upgrade replaces the program and never
touches the data. On Windows, ProgramData is a hidden folder: type the path into
File Explorer's address bar.

## Removing and installing again

Uninstalling removes the program and keeps your data, on purpose. So installing
again finds the old data and uses it: the same administrator and password, the
same records, and the same port. You are not asked to create an administrator,
because one exists.

To start from nothing, uninstall, delete the data folder, and install again.
**That erases the database, the evidence and the backups for good.** Forgot the
administrator password? Do not start fresh; the administrator guide shows how
to reset it.

## Backups

One is taken automatically every night. The folder keeps the newest three
backups in all, whether taken at night, by hand, or before an update or a
restore; older ones are deleted. Each backup is a single file holding the
database **and** every evidence document.

**Backups** lets an administrator take one now, download one, upload one, and
restore one. Restoring replaces everything, takes a backup of the present
first, and signs everybody out.

Download one regularly and keep it somewhere that is not this server.

## Updates

**Settings → Updates.** Nothing is checked or downloaded until an administrator
presses the button. An update takes a backup first, and if the new version does
not start properly the old one and your data are put back automatically.

## Who can see the documents you upload

Anyone who can sign in and read. Evidence is served as an attachment, never
opened in the browser, so an uploaded file cannot run anything against your
session.

A backup file holds every document and every password hash, so treat one as you
would treat the server itself.
