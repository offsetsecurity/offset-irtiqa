# Being ready for SAMA

The last page of the handbook: a checklist to work through before your
self-assessment or a SAMA review, the gaps to check first, and a yearly cycle.

Part of [the SAMA handbook](sama-01-how-assessment-works.md). Previous:
[Documents, approvals and reports to SAMA](sama-06-documents-and-approvals.md).

## The readiness checklist

### Governance (3.1)

- The cyber security committee exists by board mandate, is chaired by an
  independent senior manager from a control function, and meets at least
  quarterly under an approved charter.
- The cyber security function is independent of IT: separate reporting line,
  budget and staff evaluations.
- A full-time CISO is appointed at senior management level, with SAMA's
  no-objection on file.
- The governance, strategy and policy are approved by the committee and
  endorsed by the board, and the policy has been reviewed on schedule.
- Security responsibilities are in job descriptions.
- Awareness runs through the year for staff, third parties and customers, and
  its effectiveness is measured.
- Role-based security training is recorded.

### Risk and compliance (3.2)

- The risk management process is documented and aligned with enterprise risk
  management.
- Risk appetite and tolerance are formally approved.
- Risk assessments involve the right people and are signed off by risk owners.
- Regulatory requirements are tracked, and changes feed into the policy.
- PCI DSS, EMV and SWIFT compliance is current, where they apply.
- Customer-facing and internet-facing services had a penetration test this
  year.
- Cyber security audits are independent, planned, and their findings followed
  up.

### Operations and technology (3.3)

- Every subdomain's standard or process is approved, compliance with it is
  monitored, and you know how you will measure its effectiveness.
- The asset register is unified, with an owner and classification for every
  asset.
- Multi-factor authentication covers all remote access, sensitive and critical
  systems, and privileged access to critical systems where your risk assessment
  calls for it.
- Access is reviewed periodically, and leavers lose access on time.
- Every change carries business owner, security and CAB approval.
- DDoS scrubbing has been tested at least twice a year, where DDoS protection
  applies.
- A SOC monitors 24x7, with a SIEM, and has been tested independently.
- Medium and high incidents were reported to SAMA immediately, and formal
  reports sent after recovery.
- Vulnerabilities are scanned on a risk-based schedule and fixed within the
  set timelines.
- **Banks:** 3.3.14 to 3.3.17 are at level 4, with key risk indicators and trend
  reports to show it.

### Third parties (3.4)

- Contracts carry baseline security requirements and the right to review and
  audit.
- SAMA approved each material outsourcing before it started.
- SAMA approved each cloud service before use, and data stays in Saudi Arabia
  unless SAMA explicitly approved otherwise.

**In Offset Irtiqa.** **Get ready** tracks much of this. The **Gap report**
lists every control below its target, and the **Readiness plan** turns the
gaps into dated work.

## Gaps to check first

These are specific, testable requirements in the framework, and easy to miss:

- **The CISO's independence.** Cyber security reporting to the CIO, or sharing
  IT's budget, fails 3.1.1.6 however good the team is.
- **The committee chair.** It must be an independent senior manager from a
  control function (3.1.1.2), not the CIO.
- **SAMA's no-objection for the CISO** (3.1.1.9), on file.
- **Effectiveness, not just compliance.** Many subdomains ask for effectiveness
  to be measured and evaluated. Compliance checks alone do not show it.
- **Customer protections in electronic banking** (3.3.13.4): lockout after three
  wrong attempts, mobile number changes only at a branch or ATM, SMS alerts to
  both old and new numbers, MFA on beneficiary changes and password resets.
- **The incident report's content** (3.3.15.7), including cost estimates.
- **Cloud approvals** (3.4.3.4) obtained before use, not after.

## A suggested yearly cycle

| When | What |
|---|---|
| Every quarter | Committee meeting with minutes; maturity assessment to the committee; access reviews; KPI and, for level 4, KRI reporting |
| Twice a year | DDoS scrubbing test, where DDoS protection applies |
| Every year | Policy and architecture review; penetration tests of customer-facing and internet-facing services; awareness and training plans refreshed; risk appetite reviewed; independent cyber security audit |
| Continuously | Event monitoring 24x7; incidents reported to SAMA as they occur; threat intelligence analysed and shared |
| When SAMA asks | The self-assessment, on SAMA's questionnaire |

Quarterly committee meetings and twice-yearly DDoS tests are SAMA's own
minimums. The rest is a suggestion: controls that say "periodically" leave
the frequency to you.
Write down the frequency you chose, and keep to it.
