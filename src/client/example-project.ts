import type { PrdDocument } from '@shared/types';

export const exampleSourceName = 'sample-interview-notes.txt';
export const exampleSource = `FICTIONAL EXAMPLE - meeting scheduling for a small internal team.

Operations coordinator: "I spend time finding a slot that works across three calendars."
Team lead: "I need to know when a proposed meeting has no available room."
Support colleague: "A cancellation should free the room promptly."

Confirmed for this example: coordinators can see availability and propose one meeting time; attendees may accept or decline; room conflicts must be shown before confirmation. No measured baseline or target has been approved. Calendar write integration, external guests and mobile apps have not been decided.
`;

const exampleBodies: Record<string, string> = {
  Problem:
    'Coordinators currently compare calendars and room availability by hand. The fictional interview notes describe the effort and the need to catch room conflicts before confirmation. The scale of the problem is unmeasured.',
  Context:
    'This is a fictional example for exploring PRD Genie. Source: sample-interview-notes.txt. Its three interview excerpts and the confirmed decisions are illustrative, not real research. Calendar write integration remains undecided.',
  'Target users':
    '- Operations coordinators proposing meetings\n- Team leads checking room availability\n- Attendees responding to a proposal',
  Goals:
    '- Help a coordinator find and propose a time with an available room.\n- Make conflicts visible before confirmation.\n- Make responses and cancellations clear to participants.',
  'Non-goals':
    '- External guest invitations in the first version.\n- A mobile application.\n- Automatic calendar writes until integration and consent are decided.',
  Scope:
    'The first version covers internal availability viewing, one proposed slot, attendee responses and cancellation. It does not automatically schedule a meeting in a third-party calendar.',
  'User journeys':
    '1. A coordinator selects attendees and a room, then sees available times.\n2. The coordinator proposes one time and attendees respond.\n3. If the room becomes unavailable, the proposal shows a conflict and cannot be confirmed.\n4. On cancellation, the room returns to the available pool.',
  'Requirements and acceptance criteria':
    '1. **Availability:** Show a time as available only when every selected attendee and the room are free. Acceptance: a fixture with one room conflict does not offer that slot.\n2. **Proposal:** Let the coordinator send one proposed slot. Acceptance: attendees can see the time, room and response options.\n3. **Conflict:** Recheck room availability before confirmation. Acceptance: a newly conflicting booking blocks confirmation and explains why.\n4. **Cancellation:** Release a held room when the meeting is cancelled. Acceptance: the same room and time become available after cancellation completes.',
  'Success measures':
    'Measure time to propose a valid slot, conflict rate before confirmation and cancellation failures during a private pilot. Baseline and target values remain open; do not infer improvement from this sample.',
  Dependencies:
    '- Availability data for attendee and room calendars.\n- A decision on whether proposed meetings may write to calendars.\n- Clear ownership of room reservation state.',
  Risks:
    '- **Stale availability:** Recheck immediately before confirmation and explain conflicts.\n- **Unclear calendar permissions:** Keep write access out of the first version pending a decision.\n- **Missed cancellation:** Record a retryable release operation and surface unresolved failures.',
  'Open questions':
    '- Which calendar system is authoritative for rooms?\n- Who may invite external guests?\n- What baseline and target should the team use after observing real usage?',
  Rollout:
    'Start with a small internal pilot using test calendars and rooms. Verify conflict and cancellation cases before broader use. Capture baseline measures and resolve the calendar write decision before enabling any integration.',
};

export function fillExample(document: PrdDocument): PrdDocument['sections'] {
  return document.sections.map((section) => ({
    ...section,
    body:
      exampleBodies[section.title] ??
      `Purpose: ${section.purpose ?? section.title}. Add confirmed information before treating this section as complete.`,
  }));
}
