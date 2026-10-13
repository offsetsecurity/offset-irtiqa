# Privacy and personal data

What personal data the Offset products hold, where it is, who can see it, and
how long it stays. For a customer's data protection officer, and for
questionnaires under GDPR, the Saudi Personal Data Protection Law (PDPL) and
similar laws.

Applies to Offset Irtiqa.

## Who is responsible for the data

**The customer.** The product runs on the customer's own server. Offset
Security has no access to it, receives nothing from it, and does not process
the data on the customer's behalf.

Offset Security only sees personal data if the customer sends it: for example
a log file or a backup attached to a support request. A log has passwords,
cookies and keys stripped, but it does contain IP addresses. A backup contains
everything. Send a backup only if you mean to.

## What personal data is stored

| Data | About whom | Why |
|---|---|---|
| Username, name, email, role | People who sign in | To sign in, and to send reminders and password resets |
| Password hash | People who sign in | To check passwords. Argon2id; the password itself is never stored |
| Last sign-in time, failed sign-in count | People who sign in | Lockout after repeated failures |
| IP address and browser name of each session | People who sign in | To manage sessions |
| Audit trail: name, IP address, time, and the values before and after each change | People who sign in | To show who did what, which is the point of a compliance record |
| IP address of each password reset request | Administrators | To trace misuse of the reset form |
| Owner names and email addresses on controls, evidence, risks, tasks, policies, incidents and findings | Staff named as owners, who may never sign in | To say who is responsible, and to email them reminders |
| Whatever is in uploaded evidence files | Anyone the files mention | Proof for audits. The product does not read or index file contents |
| IP addresses and pages requested | Anyone who reaches the product | Logs, for troubleshooting |

The product asks for nothing more sensitive than names, work email addresses
and IP addresses. Uploaded evidence can contain anything, so what goes in is
the customer's choice.

## Where it is

Only on the customer's server:

- the database file (everything in the table except files and logs),
- the evidence folder (uploaded files),
- the backup folder (copies of both),
- the log folder.

Nothing is sent to Offset Security or anyone else. There is no telemetry.

**Emails** the product sends (reminders, the daily digest, temporary
passwords) go through the customer's own mail server, only if the customer
sets one up. They contain names, titles of the items concerned and due dates.

**The update check** is made only when an administrator presses the button.
It downloads a release file from GitHub and sends nothing but the server's IP
address and a standard request, as any download does.

## Who can see it

| Role | Sees |
|---|---|
| Administrator | Everything, including the list of users and their email addresses |
| Auditor | All compliance records, and the audit trail: who did what, from which address. Entries for account changes include that person's email address. Not the user list |
| Contributor, Read only | All compliance records, including owner names and emails. Not the user list, not the audit trail |

Nobody can see password hashes through the product. The audit trail,
including the addresses people signed in from, is shown to administrators
and auditors only, on the Audit trail screen.

Anyone with access to the server, or to a backup file, can read everything.
Protect both accordingly.

## How long it is kept

| Data | Kept |
|---|---|
| User accounts | Until the account is disabled, and after. Accounts are disabled rather than deleted so the audit trail keeps a name |
| Sessions | Removed 12 hours after last use (configurable) |
| Password reset requests | Kept, with the requesting IP address. Not removed automatically |
| Audit trail | For ever, unless the customer sets a retention period in days |
| Records and evidence | Until someone deletes them |
| Backups | The newest three, of every kind together. The number is configurable |
| Logs | Rotated at 10 MB, with 5 older files kept for each process |

## Requests from individuals

The customer answers these, using the product as follows:

- **Access:** an administrator can see a user's account details. Records
  naming a person can be found by searching the registers. Reports export as
  PDF.
- **Correction:** names and email addresses can be edited on the account and
  on every record.
- **Erasure:** records can be deleted. A user account cannot be deleted, but
  an administrator can disable it and replace the name and email with neutral
  values. The audit trail keeps the name that was recorded at the time of each
  change; removing that means editing the database directly, and deleting
  audit history should be a deliberate decision.
- **Backups** keep old copies of the data until they are rotated out or
  deleted.

## Security of the data

How it is protected (hashing, encryption, roles, HTTPS, backups, updates) is
in the [security overview](security-overview.md).

**Encryption at rest:** the product hashes passwords and encrypts the mail
server password. It does not encrypt the database, evidence or backups. Use
disk encryption on the server.
