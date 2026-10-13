# API reference

Every endpoint the application serves: 126 of them, all under `/api/v1`. The
same API is in every product. Where an endpoint only does something in some
products, the table says so.

The API exists for the product's own web page. It is stable enough to script
against, but there are no API keys yet: a script signs in the way a browser
does.

## The basics

| | |
|---|---|
| **Format** | JSON in and out, except file uploads (multipart) and downloads (PDF or file) |
| **Signing in** | `POST /api/v1/auth/login` sets two cookies: `offset_sid` (the session, HttpOnly) and `offset_csrf` |
| **Every change** | Every `POST`, `PUT`, `PATCH` and `DELETE` that needs a role must send the `offset_csrf` cookie's value back in an `x-csrf-token` header. That is all of them except signing in and out, creating the first administrator, and Forgot password |
| **Roles** | **Read:** any signed-in user. **Write:** Contributor or Administrator. **Admin:** Administrator only. Checked on the server for every request |
| **Validation** | Every body and query is checked against a schema. Unknown or badly formed values get a 400 |
| **Request size** | 2 MB for JSON. Uploads up to `MAX_UPLOAD_MB` (25 MB by default), one file per request |

**Errors** always look like this:

```json
{ "error": "Invalid request.", "detail": [{ "path": "owner", "message": "Expected string" }] }
```

| Status | Means |
|---|---|
| 400 | The request failed validation, or the product does not have that feature (the baseline, example data) |
| 401 | Not signed in |
| 403 | Signed in, but the role does not allow it, the CSRF token is missing or wrong, or the password must be changed first |
| 404 | Not found. Also the Get ready plan in a product without one |
| 409 | Conflicts with the current state, such as a first administrator that already exists |
| 429 | Too many requests (the Forgot password form) |
| 503 | A backup is being restored. Try again in a moment |

## Health

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/v1/health` | Anyone | Product, version and uptime. For monitoring |
| GET | `/api/v1/health/ready` | Anyone | 200 when the database answers, 503 when it does not |

## Signing in

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/v1/auth/bootstrap` | Anyone | Whether a first administrator still needs to be created |
| POST | `/api/v1/auth/bootstrap` | Anyone, once | Create the first administrator (`username`, `name`, `email`, `password`). Refused once one exists |
| POST | `/api/v1/auth/login` | Anyone | `username`, `password`. 5 failures lock the account for 15 minutes; 20 failures from one address block that address for 15 minutes (429) |
| POST | `/api/v1/auth/logout` | Signed in | End this session |
| POST | `/api/v1/auth/forgot` | Anyone | `identifier`. Emails an administrator a temporary password. Same answer whatever you send. 5 per 15 minutes |
| POST | `/api/v1/auth/password` | Signed in | Change your own password. Ends your other sessions |
| GET | `/api/v1/auth/me` | Signed in | Who you are, and your role |

## Programme and Get ready

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/v1/programme` | Read | Scope, risk method, and product-specific settings (tiers, the system, the baseline) |
| PATCH | `/api/v1/programme` | Write | Change any of them |
| GET | `/api/v1/journey` | Read | The Get ready plan, with each step's state and why |
| PUT | `/api/v1/journey/:taskId` | Write | Mark a step done, not applicable (with a reason), or open again |
| GET | `/api/v1/thread` | Read | The golden thread: every control, each risk with the controls that treat it, and linked proof with its age in days |

## Controls

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/v1/controls` | Read | Every control. Filters: `theme`, `status`, `owner`, `q` (search) |
| GET | `/api/v1/controls/summary` | Read | Counts for the dashboard |
| GET | `/api/v1/controls/:id` | Read | One control, with its guidance, links and evidence |
| PATCH | `/api/v1/controls/:id` | Write | Status, owner, dates, notes, maturity, applicability, parameters, profiles |

| POST | `/api/v1/controls/:id/tests` | Write | Record a test |
| DELETE | `/api/v1/controls/:id/tests/:testId` | Write | Remove a test |

## Evidence

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/v1/evidence` | Read | Every item. Filters: `freshness` (fresh, ageing, due, stale, unknown), `owner` |
| GET | `/api/v1/evidence/summary` | Read | Counts by freshness |
| GET | `/api/v1/evidence/:id` | Read | One item, with its linked controls |
| POST | `/api/v1/evidence` | Write | Add an item |
| PATCH | `/api/v1/evidence/:id` | Write | Change it, or its links |
| DELETE | `/api/v1/evidence/:id` | Write | Delete it, and its file |
| POST | `/api/v1/evidence/:id/file` | Write | Attach a file (multipart) |
| GET | `/api/v1/evidence/:id/file` | Read | Download the file. Always sent as an attachment |
| DELETE | `/api/v1/evidence/:id/file` | Write | Remove the file, keep the record |

## Risks

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/v1/risks` | Read | Every risk. Filters: `status`, `band` (critical, elevated, acceptable), `owner` |
| GET | `/api/v1/risks/summary` | Read | Counts and the heat map |
| GET | `/api/v1/risks/:id` | Read | One risk, with its links |
| POST | `/api/v1/risks` | Write | Add a risk |
| PATCH | `/api/v1/risks/:id` | Write | Change it, or its links |
| DELETE | `/api/v1/risks/:id` | Write | Delete it |

## Registers

Eleven registers share one shape. For each `{register}` below:

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/v1/{register}` | Read | Every row |
| GET | `/api/v1/{register}/:id` | Read | One row, with its links |
| POST | `/api/v1/{register}` | Write | Add a row |
| PATCH | `/api/v1/{register}/:id` | Write | Change it, or its links |
| DELETE | `/api/v1/{register}/:id` | Write | Delete it |

| `{register}` | In the menu of |
|---|---|
| `assets`, `policies`, `tasks`, `incidents`, `findings` | Every product |

## Reports, calendar and trend

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/v1/reports` | Read | The reports this product offers |
| GET | `/api/v1/reports/:id` | Read | Generate one as a PDF |

| GET | `/api/v1/trend` | Read | Daily progress history, for the dashboard chart |

## Settings

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/v1/settings/branding` | Read | The logo on reports |
| PUT | `/api/v1/settings/branding` | Admin | Change it |
| GET | `/api/v1/settings/smtp` | Admin | Mail server settings. The password is never returned |
| PUT | `/api/v1/settings/smtp` | Admin | Change them. The password is stored encrypted |
| POST | `/api/v1/settings/smtp/test` | Admin | Send a test email |
| GET | `/api/v1/settings/certificate` | Admin | The HTTPS certificate in use, what it is for, when it expires, and whether a restart is needed |
| PUT | `/api/v1/settings/certificate` | Admin | Upload one: `.pfx` or PEM files as base64, and a password. Returns the warnings first unless `confirm` is true. The key is never returned |
| DELETE | `/api/v1/settings/certificate` | Admin | Remove the uploaded one. Refused when the server answers the network and would then not start |
| GET | `/api/v1/settings/digest` | Admin | Daily digest settings |
| PUT | `/api/v1/settings/digest` | Admin | Change them |
| GET | `/api/v1/settings/digest/preview` | Admin | What today's digest would say |
| POST | `/api/v1/settings/digest/send` | Admin | Send it now |

## Users

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/v1/users` | Admin | Everyone who can sign in |
| POST | `/api/v1/users` | Admin | Add someone |
| GET | `/api/v1/users/:id` | Admin | One user |
| PATCH | `/api/v1/users/:id` | Admin | Name, email, role, or disable. Disabling ends their sessions |
| POST | `/api/v1/users/:id/password` | Admin | Set their password. Ends their sessions |
| POST | `/api/v1/users/:id/unlock` | Admin | Clear a lockout |

## Audit trail

Administrators and auditors only; everyone else gets 403. Read only: there is
no endpoint that changes or deletes an entry.

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/v1/audit` | Admin, auditor | Entries, newest first. Filters: `q` (text), `person`, `action`, `entity`, `from` and `to` (ISO instants, `to` exclusive). Pages with `limit` (up to 200) and `before` (the `next` of the last page). The first page carries `total`. Each entry has its `changes`, field by field, and anything that looks like a secret hidden |
| GET | `/api/v1/audit/filters` | Admin, auditor | Every person, action and record type that appears, for the filter lists, and the retention setting |
| GET | `/api/v1/audit/export` | Admin, auditor | The same filters, as CSV (up to 100,000 rows). Formula-looking cells are made text. The download is itself recorded |

## Backups

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/v1/backups` | Admin | Every backup, with its kind and size |
| POST | `/api/v1/backups` | Admin | Take one now |
| POST | `/api/v1/backups/upload` | Admin | Upload a backup file (multipart) |
| GET | `/api/v1/backups/:name/download` | Admin | Download one |
| POST | `/api/v1/backups/:name/restore` | Admin | Restore it. Takes a backup of the present first, and signs everybody out |
| DELETE | `/api/v1/backups/:name` | Admin | Delete one |

## Updates and background work

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/v1/updates` | Admin | This version, the install kind, and any update in progress |
| POST | `/api/v1/updates/check` | Admin | Fetch and verify the latest signed release |
| POST | `/api/v1/updates/apply` | Admin | Ask the updater to install it |
| GET | `/api/v1/jobs` | Admin | Recent background jobs: backups, reminders, the digest |

## Example data

| Method | Path | Who | What |
|---|---|---|---|

## Not in the API

- **API keys** for scripts and integrations do not exist yet.
