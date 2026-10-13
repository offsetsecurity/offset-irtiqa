# Who can do what

## The four roles

| Role | Read | Change | Users and settings |
|---|---|---|---|
| Administrator | Yes | Yes | Yes |
| Contributor | Yes | Yes | No |
| Auditor | Yes, including the audit trail | No | No |
| Read only | Yes | No | No |

If a button is missing, or a change is refused, that is your role rather than a
fault.

## Passwords

**A new person:** an administrator can invite you instead of choosing a password for
you. You are emailed a one-time password. It works once, for 3 days, and opens nothing
but the page where you choose your own password. Nobody else ever knows it, including
the administrator. If it expires, ask for another.

**Everyone except administrators, if you forget it:** ask an administrator, who can set
a new one for you under Users.

**Administrators:** use **Forgot password?** on the sign-in page. A temporary
password is emailed to you. It works once, for 30 minutes, and opens nothing
but the page that sets a new one. Your old password keeps working until you use
it, so nobody can lock you out by typing your name into the form.

If no email arrives, email may not be set up. Ask another administrator, or see
the administrator guide for the command that issues one at the server.

## Disable, do not delete

The audit trail points at people. Deleting an account would leave "who approved
this" without an answer, which is the one question an audit trail exists to
answer. Disabling stops somebody signing in and keeps the history.

## What is recorded

Every change: who, what, when, and what it was before. Reports record who
produced them. Restores record who asked for them. Sign-ins and failed
sign-ins are recorded too. None of it can be edited from the screens, by
anybody, including administrators.

## Reading the audit trail

Administrators and auditors see **Audit trail** in the menu. Nobody else does:
it holds failed sign-ins and addresses, which are security information.

- Newest first. Search, or pick a person, an action or dates.
- Click an entry to see what it changed: each field, before and after.
- **Download CSV** gives everything that matches, as a spreadsheet for an
  auditor. The download is itself recorded.

## Too many wrong passwords

Five wrong passwords lock that account for 15 minutes. Twenty failed sign-ins
from one address, to any accounts, block that address for 15 minutes, so one
computer cannot guess at everyone's password or lock everyone out.
