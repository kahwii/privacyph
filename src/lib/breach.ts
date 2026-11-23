/**
 * Breach notification assessment.
 *
 * Encodes the notification test and timing rules from the Data Privacy Act
 * (Sec. 20), its IRR (Rule IX, Sec. 38), and NPC Circular 16-03.
 *
 * IMPORTANT: every rule below carries the citation it came from. Before you
 * demo this, open each cited section and confirm the wording still matches —
 * this module is a convenience over the text, never a replacement for it, and
 * the output is general information, not legal advice.
 */

export type DataCategory =
  | 'sensitive_personal'   // SPI as defined in RA 10173, Sec. 3(l)
  | 'financial'            // data about financial or economic situation
  | 'credentials'          // usernames, passwords, other login data
  | 'biometric'
  | 'identity_documents'   // copies of IDs, licenses, unique identifiers
  | 'basic_contact'        // name, address, phone, email alone
  | 'other';

export interface BreachIntake {
  /** What kinds of personal data were involved. */
  categories: DataCategory[];
  /** Is there reason to believe an unauthorized person acquired the data? */
  unauthorizedAcquisition: boolean;
  /** Is the acquisition likely to give rise to a real risk of serious harm? */
  riskOfSeriousHarm: boolean;
  /** Approximate number of affected data subjects. */
  affectedCount: number;
  /** When the PIC gained knowledge or reasonable belief of the breach. */
  knownAt: Date;
}

export interface Citation {
  shortCode: string;
  section: string;
}

export interface BreachAssessment {
  notifiable: boolean;
  /** Each element of the test, so the UI can show which prong failed. */
  test: { label: string; satisfied: boolean; citation: Citation }[];
  /** True when the circular allows no postponement at all. */
  noDelayPermitted: boolean;
  noDelayReasons: string[];
  deadline: Date | null;
  hoursRemaining: number | null;
  notifyParties: string[];
  submissionChannel: string;
  notes: string[];
}

const NOTIFICATION_WINDOW_HOURS = 72;

/**
 * Categories that, on their own, can make a breach notifiable — sensitive
 * personal information, or other information that may be used to enable
 * identity fraud. NPC Circular 16-03 lists financial or economic data,
 * login credentials, biometric data, and copies of identification documents
 * or licenses among the latter.
 */
const QUALIFYING: DataCategory[] = [
  'sensitive_personal',
  'financial',
  'credentials',
  'biometric',
  'identity_documents',
];

/** Breach notification requires all three prongs. */
export function assess(intake: BreachIntake): BreachAssessment {
  const qualifyingData = intake.categories.some((c) => QUALIFYING.includes(c));

  const test = [
    {
      label:
        'The data involves sensitive personal information, or other information that may be used to enable identity fraud',
      satisfied: qualifyingData,
      citation: { shortCode: 'NPC-16-03', section: 'Sec. 17(A)' },
    },
    {
      label:
        'There is reason to believe the information may have been acquired by an unauthorized person',
      satisfied: intake.unauthorizedAcquisition,
      citation: { shortCode: 'NPC-16-03', section: 'Sec. 17(B)' },
    },
    {
      label:
        'The unauthorized acquisition is likely to give rise to a real risk of serious harm to the affected data subject',
      satisfied: intake.riskOfSeriousHarm,
      citation: { shortCode: 'NPC-16-03', section: 'Sec. 17(C)' },
    },
  ];

  const notifiable = test.every((t) => t.satisfied);

  // No postponement where the breach reaches 100 data subjects, or where
  // disclosure of sensitive personal information will cause harm.
  const noDelayReasons: string[] = [];
  if (intake.affectedCount >= 100) {
    noDelayReasons.push(
      `The breach involves at least 100 data subjects (${intake.affectedCount}).`
    );
  }
  if (intake.categories.includes('sensitive_personal') && intake.riskOfSeriousHarm) {
    noDelayReasons.push(
      'Disclosure of sensitive personal information will harm or adversely affect the data subjects.'
    );
  }

  const deadline = notifiable
    ? new Date(intake.knownAt.getTime() + NOTIFICATION_WINDOW_HOURS * 3600_000)
    : null;

  const notes: string[] = [];
  if (notifiable) {
    notes.push(
      'Notification of the Commission and notification of the affected data subjects are separate obligations — doing one does not satisfy the other.'
    );
    notes.push(
      'Notify on the basis of available information even if the full extent of the breach is not yet established; supplement the report as facts develop.'
    );
    if (noDelayReasons.length === 0) {
      notes.push(
        'Where delay is permitted, it may only run as far as necessary to determine the scope of the breach, prevent further disclosure, or restore reasonable integrity to the system. A postponement or exemption must be requested from the NPC.'
      );
    } else {
      notes.push('No postponement is available on these facts — notify within the window.');
    }
  } else {
    const failed = test.filter((t) => !t.satisfied).length;
    notes.push(
      `${failed} of the 3 elements is not met on these facts, so notification does not appear to be required. Record the incident in your security incident register and include it in your Annual Security Incident Report.`
    );
    notes.push(
      'If any fact changes — a new category of data, or evidence of exfiltration — reassess immediately. The 72-hour clock runs from knowledge or reasonable belief, not from confirmation.'
    );
  }

  return {
    notifiable,
    test,
    noDelayPermitted: notifiable && noDelayReasons.length > 0,
    noDelayReasons,
    deadline,
    hoursRemaining: deadline
      ? Math.round(((deadline.getTime() - Date.now()) / 3600_000) * 10) / 10
      : null,
    notifyParties: notifiable
      ? ['National Privacy Commission', 'Affected data subjects']
      : [],
    submissionChannel: 'Data Breach Notification Management System (DBNMS)',
    notes,
  };
}

export interface OrgDetails {
  name: string;
  dpoName: string;
  dpoEmail: string;
  dpoPhone: string;
}

/**
 * Drafts a notification covering the required contents: the nature of the
 * breach, the personal data possibly involved, and the measures taken to
 * address it, plus the DPO's contact details.
 *
 * Fill every bracketed placeholder before sending. Do not send this as-is.
 */
export function draftNotification(
  intake: BreachIntake,
  assessment: BreachAssessment,
  org: OrgDetails
): string {
  const fmt = (d: Date) =>
    d.toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' });

  const categoryLabels: Record<DataCategory, string> = {
    sensitive_personal: 'sensitive personal information',
    financial: 'data on the financial or economic situation of data subjects',
    credentials: 'usernames, passwords, and other login data',
    biometric: 'biometric data',
    identity_documents: 'copies of identification documents, licenses, or unique identifiers',
    basic_contact: 'names and contact details',
    other: 'other personal information',
  };

  return `PERSONAL DATA BREACH NOTIFICATION
Submitted to: National Privacy Commission, via the Data Breach Notification Management System
Personal Information Controller: ${org.name}

I. NATURE OF THE BREACH

Description: [Describe what happened in plain terms — how the breach occurred and what system was involved.]

Chronology:
  - ${fmt(intake.knownAt)} — the breach became known to the PIC, or the PIC formed a reasonable belief that it had occurred.
  - [Add the date the breach is believed to have begun, the date of discovery, and the date containment was achieved.]

Approximate number of data subjects affected: ${intake.affectedCount}

Description of likely consequences: [State the harm reasonably expected for the affected data subjects — identity fraud, financial loss, unauthorized access to accounts, and so on.]

II. PERSONAL DATA POSSIBLY INVOLVED

${intake.categories.map((c) => `  - ${categoryLabels[c]}`).join('\n')}

[List the specific fields per category, for example: full name, date of birth, mobile number, government ID number.]

III. MEASURES TAKEN TO ADDRESS THE BREACH

Measures taken to secure or recover the personal data: [Describe containment and recovery — credentials rotated, access revoked, systems patched, backups restored.]

Measures taken to prevent recurrence: [Describe the controls added or changed.]

Action taken to inform the affected data subjects: [State how and when the data subjects were notified, and what the notice said.]

Assistance provided to data subjects: [State what help is being offered — credit monitoring, dedicated hotline, forced password reset, and so on.]

IV. CONTACT DETAILS

Data Protection Officer: ${org.dpoName}
Email: ${org.dpoEmail}
Telephone: ${org.dpoPhone}

---
Notification deadline on these facts: ${assessment.deadline ? fmt(assessment.deadline) : 'not applicable'}
Parties to notify: ${assessment.notifyParties.join('; ') || 'none on these facts'}
${assessment.noDelayPermitted ? 'No postponement is available on these facts.' : ''}

Generated as general information by PrivacyPH. Not legal advice. Review every
placeholder and confirm against NPC Circular 16-03 before submission.`;
}
