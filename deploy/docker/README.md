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

## A different product

One image per framework. `PRODUCT` in `.env` selects it and is baked in at
build time:

```ini
PRODUCT=assure   # ISO/IEC 27001:2022
PRODUCT=align    # NIST Cybersecurity Framework 2.0
PRODUCT=anchor   # NIST SP 800-53 Rev. 5
PRODUCT=ascend   # SAMA Cyber Security Framework (Offset Irtiqa)
```

The project, and so every volume, is named after the product: `offset-align`,
with `offset-align_data`, `offset-align_backups` and so on. Two products on one
machine therefore get two databases without anyone having to remember to ask
for them. The volume names in the commands above change with it.

## Before you expose it

The port is bound to `127.0.0.1` on purpose. **This product terminates no TLS
of its own**, so publishing it directly would put session cookies and
passwords on the wire in clear.

Put a reverse proxy in front, give it a certificate, and only then change the
port mapping in `compose.yaml` from `127.0.0.1:8080:8080` to `8080:8080`.

## Updating

```bash
git pull
docker compose up -d --build
```

Migrations run at start-up and are idempotent. The volumes are untouched by a
rebuild. Take a backup first anyway — see above.

## Removing it

```bash
docker compose down            # stops it, keeps every volume
docker compose down -v         # ALSO DELETES THE DATABASE. There is no undo.
```
