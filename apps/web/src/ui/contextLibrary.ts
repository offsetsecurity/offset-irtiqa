/**
 * Starter issues for clause 4.1, by industry. Carried over from the
 * single-file GRC tool, where customers had already been using them.
 * Inserting one copies it into the programme's own list; nothing links back.
 */
export interface ContextIssue {
  issue: string;
  type: "Internal" | "External";
  impact: string;
}

export const CONTEXT_LIBRARY: { id: string; name: string; items: ContextIssue[] }[] = [
  {id:"general",name:"General (any organisation)",items:[
    {issue:"Customer security requirements in contracts and questionnaires",type:"External",impact:"Enterprise customers demand certification and control evidence before signing, so security directly affects revenue and shapes the certification programme."},
    {issue:"Data protection regulation (DPDP Act, GDPR where applicable)",type:"External",impact:"Personal data must be protected, breaches notified within statutory deadlines and transfers controlled, shaping privacy controls and the incident process."},
    {issue:"Ransomware and phishing threat landscape",type:"External",impact:"Sector peers have suffered outages and data loss, driving priorities for backup, endpoint protection, awareness and business continuity."},
    {issue:"Dependence on cloud and SaaS providers",type:"External",impact:"Core services run on third-party infrastructure, making supplier assurance and cloud configuration central to the risk profile."},
    {issue:"Cyber-security skills shortage in the labour market",type:"External",impact:"Specialist roles are hard to fill and retain, favouring automation, managed services and simple, maintainable controls."},
    {issue:"Size and specialist capacity of the security team",type:"Internal",impact:"Limits how many controls can be operated manually and forces prioritisation of the highest risks first."},
    {issue:"Remote and hybrid working",type:"Internal",impact:"Company data is accessed outside the office, so endpoint hardening, secure remote access and remote-working rules matter more than office physical controls."},
    {issue:"Legacy systems and accumulated technical debt",type:"Internal",impact:"Older systems are harder to patch and monitor, and may not support modern authentication or logging."},
    {issue:"Rate of change in products and infrastructure",type:"Internal",impact:"Frequent releases mean secure development and change management must be embedded in delivery rather than added afterwards."},
    {issue:"Board risk appetite and security budget",type:"Internal",impact:"Determines which risks are accepted versus treated, and what level of control investment is realistic."}
  ]},
  {id:"finance",name:"Banking, Finance & Insurance",items:[
    {issue:"Banking regulator cyber security framework and inspections",type:"External",impact:"Prescriptive regulatory controls and periodic supervisory inspection set a compliance floor above ISO 27001 and dictate reporting obligations."},
    {issue:"Data protection and customer privacy law",type:"External",impact:"Large volumes of customer financial and identity data carry statutory protection, retention and breach-notification duties."},
    {issue:"Mandatory rapid incident reporting timelines",type:"External",impact:"Short statutory reporting windows (e.g. six-hour CERT-In reporting) require rehearsed detection, triage and notification paths."},
    {issue:"AML / KYC data retention obligations",type:"External",impact:"Identity and transaction records must be retained for long periods, expanding the volume of sensitive data requiring protection."},
    {issue:"Payment card industry standards (PCI DSS)",type:"External",impact:"Cardholder data brings a separate, prescriptive control regime that must be reconciled with the ISMS."},
    {issue:"Data localisation requirements for payment data",type:"External",impact:"Restricts where payment and customer data may be stored or processed, constraining cloud architecture and cross-border transfers."},
    {issue:"Banks are a priority target for financially motivated attackers",type:"External",impact:"Attacker capability and persistence are higher than for most sectors, justifying stronger detection, fraud controls and threat intelligence."},
    {issue:"Availability attacks on digital banking channels",type:"External",impact:"DDoS and application attacks against net banking and mobile apps threaten service availability and customer trust."},
    {issue:"Customer-facing fraud: phishing, vishing and mule accounts",type:"External",impact:"Attacks target customers rather than the bank's perimeter, requiring customer education, transaction monitoring and fraud controls."},
    {issue:"Dependence on interbank payment rails",type:"External",impact:"Availability and integrity of SWIFT, RTGS/NEFT, UPI and card networks sit outside direct control yet are critical to service delivery."},
    {issue:"Concentration on a small number of critical vendors",type:"External",impact:"Core banking, cloud and payment processing are supplied by few providers, creating concentration and exit risk."},
    {issue:"Legacy core banking platform",type:"Internal",impact:"Long-lived core systems are hard to patch, may lack modern authentication and logging, and depend on scarce specialist skills."},
    {issue:"Distributed ATM, POS and branch estate",type:"Internal",impact:"Large numbers of physically exposed endpoints and sites with varying control maturity widen the attack surface."},
    {issue:"Insider access to customer accounts and funds",type:"Internal",impact:"Staff can view and move customer money, making segregation of duties, monitoring and privileged access management critical."},
    {issue:"High volume of privileged users across many systems",type:"Internal",impact:"Administrative access is spread widely, increasing the impact of credential compromise and the need for regular access review."},
    {issue:"Near-zero downtime tolerance for payment services",type:"Internal",impact:"Very short recovery objectives constrain maintenance windows and raise the importance of resilience and tested recovery."}
  ]},
  {id:"healthcare",name:"Healthcare",items:[
    {issue:"Patient data protection and confidentiality duties",type:"External",impact:"Health data is highly sensitive and legally protected, with strict consent, access and breach-notification obligations."},
    {issue:"Ransomware targeting hospitals and care delivery",type:"External",impact:"Attacks on the sector disrupt clinical services directly, making availability a patient-safety issue rather than only an IT issue."},
    {issue:"Regulated medical device constraints",type:"External",impact:"Certified devices often cannot be patched or modified freely, requiring compensating network and monitoring controls."},
    {issue:"Dependence on clinical system vendors",type:"External",impact:"EHR, imaging and laboratory systems are vendor-operated, so supplier assurance and remote-support control are central."},
    {issue:"Public scrutiny and duty of care after incidents",type:"External",impact:"Incidents affecting patients attract regulatory and media attention, raising the reputational and legal stakes."},
    {issue:"Clinical systems that cannot be taken offline",type:"Internal",impact:"Continuous care requirements limit patching and maintenance windows and complicate change management."},
    {issue:"Networked medical devices with long lifecycles",type:"Internal",impact:"Devices remain in service for many years on outdated software, requiring segmentation and monitoring instead of patching."},
    {issue:"Shift-based clinical staff and shared workstations",type:"Internal",impact:"High user turnover on shared devices makes identity, session control and clear-screen practice harder to enforce."},
    {issue:"Emergency access overriding normal procedure",type:"Internal",impact:"Break-glass access is clinically necessary but must be tightly logged and reviewed to prevent abuse."},
    {issue:"Legacy departmental and imaging systems",type:"Internal",impact:"Older specialist systems often lack modern authentication and logging yet hold significant volumes of patient data."}
  ]},
  {id:"manufacturing",name:"Manufacturing",items:[
    {issue:"Customer and OEM supply-chain security requirements",type:"External",impact:"Buyers impose security conditions down the supply chain, making certification and control evidence a commercial requirement."},
    {issue:"Attacks targeting operational technology and production",type:"External",impact:"Disruption of production has immediate financial impact, making OT availability a primary security objective."},
    {issue:"Intellectual property theft and industrial espionage",type:"External",impact:"Designs and process know-how are high-value targets, driving protection of engineering and CAD data."},
    {issue:"Product safety and sector regulation",type:"External",impact:"Safety obligations interact with security controls, so changes must consider both."},
    {issue:"Dependence on equipment vendors for maintenance",type:"External",impact:"Vendors require remote access into plant systems, creating a controlled-access requirement and a common intrusion route."},
    {issue:"OT/ICS estate with long equipment lifecycles",type:"Internal",impact:"Plant equipment runs for decades on unsupported software, requiring segmentation and monitoring rather than patching."},
    {issue:"Production uptime prioritised over patching windows",type:"Internal",impact:"Maintenance opportunities are rare and scheduled far ahead, so vulnerability remediation must be planned around production."},
    {issue:"Separate IT and OT teams and cultures",type:"Internal",impact:"Different ownership, tooling and priorities complicate consistent control implementation across the estate."},
    {issue:"Contractor and visitor access to plant areas",type:"Internal",impact:"Frequent third-party physical presence requires disciplined access control, escorting and monitoring."},
    {issue:"Design and CAD data spread across engineering systems",type:"Internal",impact:"Valuable product data exists in multiple stores, complicating classification, access control and retention."}
  ]},
  {id:"government",name:"Government",items:[
    {issue:"Statutory duties over citizen data",type:"External",impact:"Legal obligations govern how citizen records are collected, used, shared and protected, with limited discretion."},
    {issue:"Public transparency and information-request obligations",type:"External",impact:"Disclosure duties must be balanced against confidentiality, requiring careful classification and handling rules."},
    {issue:"Nation-state and hacktivist targeting of public services",type:"External",impact:"Public bodies face capable, motivated adversaries pursuing disruption or intelligence rather than money."},
    {issue:"Public and political scrutiny after incidents",type:"External",impact:"Incidents become public quickly, raising the reputational stakes and the need for a rehearsed response."},
    {issue:"Procurement rules constraining technology choice and speed",type:"External",impact:"Formal procurement limits how quickly security tooling and services can be adopted."},
    {issue:"Legacy systems of record with long replacement cycles",type:"Internal",impact:"Core registries and case systems are old and difficult to change, requiring compensating controls."},
    {issue:"Large workforce with access to citizen records",type:"Internal",impact:"Broad access across many staff makes insider browsing and misuse a leading internal concern."},
    {issue:"Inter-agency data sharing dependencies",type:"Internal",impact:"Data flows between agencies extend the trust boundary and require agreed handling and assurance."},
    {issue:"Budget cycles constraining security investment",type:"Internal",impact:"Annual funding cycles limit when and how security improvements can be made."},
    {issue:"Classified and non-classified environments in parallel",type:"Internal",impact:"Running separate environments raises the cost and complexity of consistent control operation."}
  ]},
  {id:"education",name:"Education",items:[
    {issue:"Safeguarding duties for minors and vulnerable people",type:"External",impact:"Safeguarding records demand the highest confidentiality and tightly restricted access."},
    {issue:"Data protection obligations for student records",type:"External",impact:"Student and applicant data carries statutory protection and retention requirements."},
    {issue:"Ransomware targeting the education sector",type:"External",impact:"The sector is frequently attacked and often has limited recovery capability, making backup and continuity a priority."},
    {issue:"Nation-state interest in research output",type:"External",impact:"Sensitive or funded research attracts state-sponsored interest, requiring stronger controls on research data."},
    {issue:"Research funding and grant security conditions",type:"External",impact:"Funders impose security requirements as a condition of grants, tying compliance to research income."},
    {issue:"Open campus network culture and personal devices",type:"Internal",impact:"A permissive network with large volumes of unmanaged devices limits reliance on perimeter controls."},
    {issue:"Large transient user population",type:"Internal",impact:"Annual intake and graduation create high-volume joiner/leaver churn and account-lifecycle pressure."},
    {issue:"Devolved IT across faculties and departments",type:"Internal",impact:"Independent local IT creates inconsistent control implementation and incomplete asset visibility."},
    {issue:"Research systems outside central IT control",type:"Internal",impact:"Departmentally managed systems hold valuable data but may not meet institutional security standards."},
    {issue:"Limited security budget relative to user population",type:"Internal",impact:"Small central teams support very large user numbers, favouring automation and prioritised controls."}
  ]},
  {id:"automotive",name:"Automotive",items:[
    {issue:"Vehicle cyber security regulation and type approval",type:"External",impact:"Regulations such as UNECE R155/R156 require a certified cyber security management system as a condition of market access."},
    {issue:"Functional safety standards interacting with security",type:"External",impact:"Safety and security requirements must be reconciled, as security changes can affect safety certification."},
    {issue:"OEM and tier-supplier security requirements",type:"External",impact:"Security obligations flow down the supply chain, making assurance evidence a commercial prerequisite."},
    {issue:"Public security research on connected vehicles",type:"External",impact:"Researchers publicly disclose vehicle vulnerabilities, creating reputational and remediation pressure."},
    {issue:"Long product lifecycle and support obligations",type:"External",impact:"Vehicles remain in service and supported for a decade or more, extending the period over which vulnerabilities must be managed."},
    {issue:"Plant OT systems and assembly-line uptime",type:"Internal",impact:"Production disruption is immediately costly, constraining maintenance and patching of plant systems."},
    {issue:"Prototype and pre-release design data",type:"Internal",impact:"Unreleased product information is commercially sensitive and attracts both espionage and leaks."},
    {issue:"Extensive supplier and dealer network access",type:"Internal",impact:"Many external parties connect to corporate systems, widening the access-control and monitoring burden."},
    {issue:"Over-the-air update capability",type:"Internal",impact:"OTA is both the primary remediation route and a high-value attack target, requiring strong integrity controls."},
    {issue:"Embedded software difficult to patch in the field",type:"Internal",impact:"In-vehicle components cannot always be updated quickly, requiring defence in depth and long-lived compensating controls."}
  ]},
];

/** A 5x5 method an auditor will recognise. Offered when the box is empty. */
export const RISK_METHOD_TEMPLATE =
  "Each risk is scored for likelihood (1 to 5) and impact (1 to 5). The risk score is likelihood " +
  "times impact, from 1 to 25.\n\n" +
  "Acceptance: 1 to 10 is acceptable and is monitored. 12 to 16 is elevated and needs a treatment " +
  "plan agreed by management. 20 to 25 is critical: it is treated straight away and can only be " +
  "accepted by the board.\n\n" +
  "Every risk is given a treatment (mitigate, accept, transfer or avoid) and an owner. After the " +
  "treatment it is scored again to give a residual score. The risk owner accepts the residual risk " +
  "and the date is recorded.\n\n" +
  "The register is reviewed at least once a year, and after any significant change or incident.";
