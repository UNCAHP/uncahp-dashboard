// Test leads: contacts the team create to check a funnel or form. They sit in GHL like
// any other lead, carry a campaign REF tag, and nobody phones them — so left in, they
// drag every setter's Speed to Lead down. Spotted by name, email or phone.

// "test" / "sample" / "dummy" / "ignore" / "simulated" as a whole word or at a word edge
// ("zztest", "testlead"). Mid-word hits are left alone: "esther", "charlottestevens".
const TEST_WORD = /(^|[^a-z])(test|testing|tests|sample|dummy|simulated|ignore)([^a-z]|$)|(^|[^a-z])[a-z]*test([^a-z]|$)|(^|[^a-z])test[a-z]*([^a-z]|$)/i;

// Email domains only ever used for test submissions.
const TEST_DOMAINS = ['example.com', 'test.com', 'meta.com', 'yourfunnel.com'];
const isTestDomain = (d: string) => TEST_DOMAINS.includes(d) || d === 'uncahp.com' || d.endsWith('.uncahp.com');

// Ofcom's reserved UK drama range (07700 900000–900999) plus the all-zero number.
const TEST_PHONE = /^(\+?44|0)(7700900\d{3}|7000000000)$/;

// The team's own mobiles, which only ever appear on "<name> test N" contacts.
export const TEAM_PHONES = ['447954304302', '447432715824', '447827846488', '447494051867', '447732883108'];

const digits = (p: string) => p.replace(/\D/g, '').replace(/^0/, '44');

export function isTestLead(c: { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null; tags?: unknown }): boolean {
  const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
  if (name && TEST_WORD.test(name)) return true;
  const email = (c.email ?? '').trim().toLowerCase();
  if (email) {
    const [local, domain = ''] = email.split('@');
    if (isTestDomain(domain) || TEST_WORD.test(local)) return true;
  }
  const phone = (c.phone ?? '').trim();
  if (phone && (TEST_PHONE.test(phone.replace(/\s/g, '')) || TEAM_PHONES.includes(digits(phone)))) return true;
  if (Array.isArray(c.tags) && c.tags.some(t => typeof t === 'string' && /^ai test$/i.test(t))) return true;
  return false;
}
