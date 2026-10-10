# Collecting evidence from the cloud

Most of the proof an assessor wants already exists in your cloud console. The
work is exporting it, dating it, and attaching it to the right control.

Export as PDF or CSV, name it so the date is obvious, and record the collected
date in **Evidence**. Collect it again every quarter; anything older than 90
days is flagged here.

## Microsoft 365 and Entra ID

| Proof | Where | Controls |
|---|---|---|
| Multi-factor authentication is enforced | Entra ID → Conditional Access → policy, exported | 3.3.5.4 |
| Who has admin roles | Entra ID → Roles and administrators | 3.3.5.4 |
| Access review results | Entra ID Governance → Access reviews | 3.3.5.4 |
| Leavers disabled | Entra ID → Users, filtered by sign-in status | 3.3.5.4, 3.3.1.3 |
| Audit log kept | Purview → Audit search, exported | 3.3.14.4 |
| Data loss prevention rules | Purview → Data loss prevention | 3.3.8.6 |
| Endpoint protection coverage | Defender → Device inventory | 3.3.8.6 |

## AWS

| Proof | Where | Controls |
|---|---|---|
| Root account has MFA and is unused | IAM → Credential report | 3.3.5.4 |
| Who can do what | IAM → Access Analyzer findings, policy export | 3.3.5.4, 3.4.3.4 |
| Logging is on and kept | CloudTrail → Trails, S3 lifecycle rules | 3.3.14.4 |
| Encryption at rest | KMS key list, S3 bucket settings | 3.3.9.4 |
| Backups run and restore | AWS Backup → Jobs, and a restore test record | 3.3.8.6 |
| Patch level | Systems Manager → Patch compliance | 3.3.17.3 |
| Which regions hold your data | The region of each service, and your data residency record | 3.4.3.4 |

## Google Workspace and Google Cloud

| Proof | Where | Controls |
|---|---|---|
| Two-step verification enforced | Admin console → Security → Authentication | 3.3.5.4 |
| Admin activity | Admin console → Reporting → Audit | 3.3.14.4 |
| Sharing rules | Admin console → Apps → Drive → Sharing settings | 3.3.8.6 |
| Who has project access | IAM & Admin → IAM, exported | 3.3.5.4, 3.4.3.4 |
| Logging and retention | Cloud Logging → Log buckets | 3.3.14.4 |
| Where data is stored | Organisation policy → resource locations | 3.4.3.4 |

## What makes an export good evidence

**It shows the date it was taken.** A screenshot with no date proves nothing.

**It shows the whole setting, not the part that flatters you.** An assessor who
finds the crop will ask what else was cropped.

**It says who took it.** The evidence record does that for you.

**It matches what the control claims.** If the control says reviews happen
quarterly, the export should show four of them.
