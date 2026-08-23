/**
 * Starter contract templates — PLACEHOLDERS.
 *
 * These are written against the Fast Food Industry Award 2010 (MA000003) so the
 * onboarding flow can be tested end to end, and so every token has somewhere to
 * land. They have NOT been reviewed by an employment lawyer. Replace or have
 * them checked before anyone signs one — templates created from here are
 * flagged is_seed_draft and the app warns on every issue.
 */

const COMMON_TAIL = `
<h2>Award and minimum entitlements</h2>
<p>Your employment is covered by the {{award.name}} ({{award.code}}) and the National Employment Standards (NES). Where any term of this agreement is less favourable than the Award or the NES, the Award or the NES applies.</p>
<p>Your classification is {{award.classification}}.</p>

<h2>Duties</h2>
<p>You will perform the duties of {{employment.position}} and any other duties within your skill and competence that {{company.trading_name}} reasonably directs. Duties may change from time to time to suit the needs of the business.</p>

<h2>Place of work</h2>
<p>Your primary place of work is {{restaurant.name}}, {{restaurant.address}}. You may be asked to work at another of our venues from time to time.</p>

<h2>Superannuation</h2>
<p>{{company.legal_name}} will make superannuation contributions on your behalf at the rate required by law, to your chosen complying fund or, if you do not choose one, to the employer default fund or a fund stapled to you by the ATO.</p>

<h2>Pay</h2>
<p>You will be paid {{employment.pay_frequency}} by electronic funds transfer to the account you have nominated. A payslip will be issued for each pay period.</p>

<h2>Hours and breaks</h2>
<p>Rosters are published in advance. Meal and rest breaks are provided in accordance with the Award. You are expected to record your start time, finish time and breaks accurately using the time clock.</p>

<h2>Food safety, work health and safety</h2>
<p>You must comply with all food safety and work health and safety procedures, report hazards and incidents promptly, and hold and maintain any certificate required for your role.</p>

<h2>Confidentiality</h2>
<p>You must not, during or after your employment, disclose confidential information about the business, including recipes, supplier terms, financial information or customer information, except as required by law.</p>

<h2>Policies</h2>
<p>You agree to comply with our workplace policies as varied from time to time. Policies are not incorporated into this agreement and do not form part of your contract of employment.</p>

<h2>Personal information</h2>
<p>We collect and hold your personal information (including your address, date of birth, emergency contact, tax file number, superannuation and bank details) for the purpose of employing and paying you, and handle it in accordance with the Privacy Act 1988 (Cth).</p>

<h2>Termination</h2>
<p>Either party may end this employment by giving the notice required by the NES and the Award. We may terminate without notice in the case of serious misconduct.</p>

<h2>Entire agreement</h2>
<p>This document, together with the Award and the NES, sets out the whole of the agreement between us and replaces any earlier understanding or representation.</p>

<h2>Acceptance</h2>
<p>By signing below you confirm that you have read and understood this agreement, that you have had the opportunity to ask questions or seek independent advice, and that you accept the terms set out above.</p>

{{signature.block}}
`;

const HEADER = `
<h1>Employment Agreement</h1>
<p><strong>{{company.legal_name}}</strong> (ABN {{company.abn}}) trading as {{company.trading_name}}, of {{company.address}} (<em>the employer</em>)</p>
<p><strong>{{employee.legal_name}}</strong> of {{employee.address}} (<em>you</em>)</p>
<p>Dated {{today}}</p>

<table>
  <tr><th>Position</th><td>{{employment.position}}</td></tr>
  <tr><th>Employment type</th><td>{{employment.type}}</td></tr>
  <tr><th>Location</th><td>{{restaurant.name}}</td></tr>
  <tr><th>Start date</th><td>{{employment.start_date}}</td></tr>
  <tr><th>Classification</th><td>{{award.classification}}</td></tr>
</table>
`;

export const SEED_TEMPLATES: {
  name: string;
  employment_type: "casual" | "part_time" | "full_time" | null;
  kind: "contract" | "variation";
  body_html: string;
}[] = [
  {
    name: "Casual employment (MA000003) — DRAFT",
    employment_type: "casual",
    kind: "contract",
    body_html: `${HEADER}
<h2>Nature of employment</h2>
<p>You are employed on a <strong>casual</strong> basis. There is no guarantee of ongoing or regular work. You may accept or refuse any shift offered, and we may offer or not offer shifts as the business requires. Each engagement is a separate period of employment.</p>
<p>As a casual you are paid a casual loading in place of paid leave entitlements (other than unpaid carer's leave, unpaid compassionate leave and family and domestic violence leave as provided by the NES).</p>
<p>You may become eligible to convert to permanent employment in the circumstances set out in the Award and the NES. We will deal with any such request in accordance with those provisions.</p>

<h2>Rate of pay</h2>
<p>Your base rate of pay is <strong>{{employment.pay_rate}} per hour</strong>, plus the casual loading and any Award penalty rates that apply to the hours you actually work (evenings, weekends, public holidays and overtime).</p>
<p>Junior rates, where they apply, are {{award.junior_percent}} of the adult rate for your classification and increase automatically on your birthday.</p>
${COMMON_TAIL}`,
  },
  {
    name: "Part-time employment (MA000003) — DRAFT",
    employment_type: "part_time",
    kind: "contract",
    body_html: `${HEADER}
<h2>Nature of employment</h2>
<p>You are employed on a <strong>part-time</strong> basis, working a guaranteed minimum of <strong>{{employment.hours}} ordinary hours per week</strong>. Your ordinary hours, and the days and times you work them, are agreed in writing and may only be varied by agreement between us, recorded in writing.</p>
<p>You accrue paid annual leave and personal/carer's leave on a pro-rata basis in accordance with the NES.</p>

<h2>Probation</h2>
<p>The first {{employment.probation}} of your employment is a probationary period, during which either party may end the employment by giving the notice required by the NES.</p>

<h2>Rate of pay</h2>
<p>Your base rate of pay is <strong>{{employment.pay_rate}} per hour</strong>, plus any Award penalty rates that apply to the hours you actually work.</p>
<p>Junior rates, where they apply, are {{award.junior_percent}} of the adult rate for your classification and increase automatically on your birthday.</p>
${COMMON_TAIL}`,
  },
  {
    name: "Full-time employment (MA000003) — DRAFT",
    employment_type: "full_time",
    kind: "contract",
    body_html: `${HEADER}
<h2>Nature of employment</h2>
<p>You are employed on a <strong>full-time</strong> basis, working an average of 38 ordinary hours per week plus any reasonable additional hours. Your ordinary hours will be rostered in accordance with the Award.</p>
<p>You accrue paid annual leave and personal/carer's leave in accordance with the NES.</p>

<h2>Probation</h2>
<p>The first {{employment.probation}} of your employment is a probationary period, during which either party may end the employment by giving the notice required by the NES.</p>

<h2>Rate of pay</h2>
<p>Your remuneration is <strong>{{employment.pay_rate}} per hour</strong> ({{employment.pay_type}}), plus any Award penalty rates that apply to the hours you actually work. Where a salary applies, it is {{employment.salary}} per annum and is set so that it is at least equal to what you would receive under the Award for the hours you work; we will review this if your pattern of hours changes.</p>
${COMMON_TAIL}`,
  },
  {
    name: "Variation of terms — DRAFT",
    employment_type: null,
    kind: "variation",
    body_html: `<h1>Variation of Employment Terms</h1>
<p><strong>{{company.legal_name}}</strong> (ABN {{company.abn}}) and <strong>{{employee.legal_name}}</strong></p>
<p>Dated {{today}}</p>

<p>This letter varies your existing employment agreement with {{company.trading_name}}. All other terms of that agreement continue unchanged.</p>

<table>
  <tr><th>Position</th><td>{{employment.position}}</td></tr>
  <tr><th>Employment type</th><td>{{employment.type}}</td></tr>
  <tr><th>Location</th><td>{{restaurant.name}}</td></tr>
  <tr><th>Classification</th><td>{{award.classification}}</td></tr>
  <tr><th>Base rate of pay</th><td>{{employment.pay_rate}} per hour</td></tr>
  <tr><th>Ordinary hours per week</th><td>{{employment.hours}}</td></tr>
  <tr><th>Effective from</th><td>{{employment.start_date}}</td></tr>
</table>

<p>Your pay will continue to be at least the minimum required by the {{award.name}} ({{award.code}}) and the National Employment Standards.</p>

<h2>Acceptance</h2>
<p>By signing below you confirm that you agree to the varied terms set out above.</p>

{{signature.block}}`,
  },
];
