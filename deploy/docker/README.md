# Offset on Docker

Two containers, four volumes, no database server to run.

## Start it

```bash
cd deploy/docker
cp env.example .env
```

Fill in the two secrets `.env` asks for:

```bash
docker run --rm node:24-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run that twice — once for `SESSION_SECRET`, once for `FIELD_ENC_KEY` — then:

```bash
docker compose up -d --build
```

Open <http://localhost:8080>. The first person to open it creates the
administrator account.

## What runs

| Container | What it does | If it stops |
|---|---|---|
| `app` | The web interface and API on port 8080. Owns the schema and applies migrations at start-up. | Nobody can sign in. |
| `worker` | Nightly backup and pruning, the daily readiness snapshot, WAL checkpoints, housekeeping. | The product still works. Nothing is ever backed up. |

Both run from the same image and open the same SQLite file. That is safe:
writes are serialised and readers are never blocked.

**Do not scale `app` past one replica.** It is one file, and the schema is
applied at start-up, so a second copy would race the first. Scale a reverse
proxy in front instead — the bottleneck is never this.

## The four volumes

| Volume | Holds |
|---|---|
| `data` | The database. |
| `backups` | Backups: the database and every evidence document, one file each. **Copy these somewhere else.** |
| `evidence` | Uploaded evidence files. |
| `logs` | `app.log`, `worker.log`, `crash.log`. |

Both containers mount all four. Giving them separate volumes would give you
two databases and one of them would quietly be ignored.

### Keeping the data in a folder you choose

By default the four live in Docker's own storage. To keep them in a normal
folder instead, where you can see and copy them, set this in `.env` before the
first start:

```
OFFSET_DATA_DIR=D:/OffsetData/irtiqa        # Windows: forward slashes
OFFSET_DATA_DIR=/srv/offset/irtiqa          # Linux
```

The folder then holds `data`, `evidence`, `backups` and `logs`, and updates
keep using it. On Linux, give it to the application's user first:
`sudo chown -R 10001:10001 /srv/offset/irtiqa`.

Changing it on an install that already has data does not move the data. Take a
backup and download it, set the folder, start again, then upload and restore
the backup from the **Backups** screen.

### Evidence files before 0.2.35

Until 0.2.35 the image did not tell the application where the `evidence` volume
was, so uploaded files were kept inside the container and an update lost them.
From 0.2.35 they are kept in the volume. On its first start, 0.2.35 also puts
back every missing file it can find in a backup: anything uploaded before the
last nightly or manual backup comes back. **Before updating from an earlier
version, take a manual backup from the Backups screen**, so nothing is missed.

Backups are easiest from the **Backups** screen: take, download, upload and
restore. The same full backup from the command line:

```bash
docker compose exec app node dist/db/backup.js
```

## Logs

```bash
docker compose logs -f app        # live
docker compose logs --tail=100 worker
```

The same lines are in the `logs` volume as files, rotating at 10 MB with five
older copies kept. Passwords, hashes, cookies and both secrets are stripped
before anything is written, so a log is safe to send to somebody.

See [logs and troubleshooting](../../docs/ops/logs-and-troubleshooting.md) for
what each file means and a symptom-to-cause table.

## The product's name on Docker

`PRODUCT=ascend` in `.env` is Offset Irtiqa (SAMA Cyber Security Framework).
The project, and so every volume, is named after it: `offset-ascend`, with
`offset-ascend_data`, `offset-ascend_backups` and so on.

## Before you expose it

The port is bound to `127.0.0.1` on purpose: without HTTPS, publishing it
would put session cookies and passwords on the wire in clear.

Either give the product its own certificate (a `certs` folder beside
`compose.yaml`, or upload one under **Settings → HTTPS**; see `INSTALL.md`,
"Turning on HTTPS"), or put a reverse proxy with a certificate in front. Only
then change the port mapping in `compose.yaml` from `127.0.0.1:8080:8080` to
`8080:8080`. The product's own HTTPS accepts TLS 1.2 or later, with strong
ciphers only.

## What it connects to

Nothing, unless you ask:

- **Updates:** only when an administrator presses **Check for updates**, to
  `github.com` (this product's own releases page) over HTTPS.
- **Email:** only if you turn on outgoing email, to the mail server you name.

No usage data, no licence check, nothing else.

## Updating

**First, take a full backup:** Backups → **Take a backup now**, and
**Download** it. The update takes its own backup too, and the new version
copies the database into `backups/before-upgrade` before it changes anything,
but those hold the database only, not the evidence files.

**From the screen:** Settings → Updates → **Check for updates**, then
**Update now**. The `updater` container takes a backup, pulls the new image,
checks its signature and starts it. If the new version does not start, the
old one and the data are put back.

**By hand:**

```bash
docker compose exec app node dist/db/backup.js   # a backup first
docker compose pull
docker compose up -d
```

Migrations run at start-up. They only go forward, and they are safe to stop
half-way: a start that is interrupted finishes on the next start. From 0.3.0,
an older version refuses to start on a database a newer one has changed, and
says so: going back is always through a backup (below).

## Going back a version

Migrations only go forward, so the way back is the backup taken before the
update:

1. Have the full backup you took by hand before the update (Backups → Take a
   backup now, then Download). The automatic "Before an update" one holds
   the database only, and step 3 deletes the evidence files.
2. In `.env`, set `OFFSET_IMAGE` and `OFFSET_UPDATER_IMAGE` to the old
   version, for example `ghcr.io/offsetsecurity/offset-ascend:0.2.35`.
3. `docker compose down -v` (this deletes the database; you have the backup),
   then `docker compose up -d`.
4. Open the product, create a temporary first account, then **Backups →
   Upload a backup** and **Restore** the file from step 1. Everyone signs in
   again with the accounts as they were.

This was tried for 0.3.0: a backup from 0.2.35 restored onto 0.2.35 brought
every table and every evidence file back.

## Changing the secrets

| Secret | What happens when it changes |
|---|---|
| `SESSION_SECRET` | Everyone is signed out and signs in again. Nothing else changes. |
| `FIELD_ENC_KEY` | The product starts and everything works, except saved secrets such as the mail password: type it again under Settings → Outgoing email. |

Change one in `.env`, then `docker compose up -d`.

## If a release is bad

A release is never replaced or withdrawn quietly. A bad one is followed by a
new patch version that fixes or removes the change, and its notes say what
happened. Meanwhile:

- **Find out what happened:** the audit trail (menu → Audit trail), and the
  `logs` volume.
- **Go back:** see "Going back a version" above.

## Removing it

```bash
docker compose down            # stops it, keeps every volume
docker compose down -v         # ALSO DELETES THE DATABASE. There is no undo.
```
