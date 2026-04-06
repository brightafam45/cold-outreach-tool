/**
 * Email pattern guesser.
 * Generates the most likely email addresses for a person at a company domain.
 * Based on the most common corporate email formats globally.
 */

export interface EmailGuess {
  email: string
  pattern: string
  confidence: number // 0–100
}

/**
 * Generate all plausible email guesses for a person.
 * Patterns are ranked by global frequency.
 */
export function guessEmails(
  firstName: string,
  lastName: string,
  domain: string
): EmailGuess[] {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, '')
  const l = lastName.toLowerCase().replace(/[^a-z]/g, '')
  const fi = f.charAt(0)
  const li = l.charAt(0)

  if (!f || !l || !domain) return []

  return [
    { email: `${f}@${domain}`,          pattern: 'firstname',            confidence: 40 },
    { email: `${f}.${l}@${domain}`,     pattern: 'firstname.lastname',   confidence: 85 },
    { email: `${f}${l}@${domain}`,      pattern: 'firstnamelastname',    confidence: 60 },
    { email: `${fi}${l}@${domain}`,     pattern: 'flastname',            confidence: 75 },
    { email: `${fi}.${l}@${domain}`,    pattern: 'f.lastname',           confidence: 65 },
    { email: `${l}.${f}@${domain}`,     pattern: 'lastname.firstname',   confidence: 50 },
    { email: `${l}${fi}@${domain}`,     pattern: 'lastnamef',            confidence: 45 },
    { email: `${f}_${l}@${domain}`,     pattern: 'firstname_lastname',   confidence: 35 },
    { email: `${f}${li}@${domain}`,     pattern: 'firstnamel',           confidence: 30 },
    { email: `${f}-${l}@${domain}`,     pattern: 'firstname-lastname',   confidence: 25 },
  ].sort((a, b) => b.confidence - a.confidence)
}

/**
 * Parse a full name into first and last name.
 */
export function parseName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return {
    firstName: parts[0],
    lastName: parts[parts.length - 1],
  }
}
