/**
 * Contact finder — the core engine.
 * Combines Google search, website scraping, LinkedIn profile discovery,
 * email guessing, and SMTP verification to find real decision makers.
 */

import { findLinkedInProfiles, findTeamPage } from '@/lib/scrapers/google'
import { scrapeTeamPage, extractDomain, type RawContact } from '@/lib/scrapers/website'
import { guessEmails, parseName } from '@/lib/contacts/emailGuesser'
import { findBestEmail } from '@/lib/contacts/emailVerifier'
import { prompt, type AIProvider } from '@/lib/ai/provider'

// Titles we care about for content/marketing outreach
const TARGET_TITLES = [
  'Head of Content',
  'Content Director',
  'Content Manager',
  'Director of Content',
  'VP of Content',
  'VP of Marketing',
  'Head of Marketing',
  'Marketing Director',
  'Content Strategist',
  'Editor in Chief',
  'Managing Editor',
  'Chief Marketing Officer',
  'CMO',
  'Founder',
  'Co-Founder',
  'CEO', // For small companies
]

const TARGET_TITLE_PATTERN = new RegExp(
  TARGET_TITLES.map((t) => t.replace(/\s+/g, '\\s*')).join('|'),
  'i'
)

export interface FoundContact {
  name: string
  title: string
  linkedinUrl: string | null
  email: string | null
  emailStatus: string
  confidence: number
  rank: number
  source: string
}

/**
 * Extract name and title from a LinkedIn Google search result.
 */
function parseLinkedInResult(title: string, snippet: string): { name: string; jobTitle: string } | null {
  // LinkedIn results format: "Name - Title at Company | LinkedIn"
  const match = title.match(/^(.+?)\s*[-–|]\s*(.+?)(?:\s+at\s+|\s*\|\s*LinkedIn|\s*[-–])/i)
  if (match) {
    return {
      name: match[1].trim(),
      jobTitle: match[2].trim(),
    }
  }

  // Fallback: try snippet
  const snippetMatch = snippet.match(/([A-Z][a-z]+ [A-Z][a-z]+).*?(Head|Director|Manager|VP|CMO|CEO|Editor|Founder)/i)
  if (snippetMatch) {
    return { name: snippetMatch[1], jobTitle: snippetMatch[2] }
  }

  return null
}

/**
 * Use AI to rank contacts and identify the best fit.
 */
async function rankContactsWithAI(
  contacts: Array<{ name: string; title: string }>,
  companyName: string,
  purpose: string,
  provider: AIProvider,
  model: string
): Promise<Array<{ name: string; rank: number; confidence: number; reasoning: string }>> {
  if (contacts.length === 0) return []

  const systemPrompt = `You are an expert at B2B outreach. Your job is to rank contacts at a company by how likely they are to respond to a cold outreach from a freelance content writer.`

  const userPrompt = `I want to reach out to ${companyName} about freelance writing/content work (${purpose}).

Here are the people I found:
${contacts.map((c, i) => `${i + 1}. ${c.name} — ${c.title}`).join('\n')}

Rank them from most to least likely to be the right person to contact. Consider:
- Who actually makes hiring/commission decisions for content?
- Who would care most about content quality?
- For small companies, founders/CEOs are often the decision makers.

Return JSON array:
[{"name": "...", "rank": 1, "confidence": 85, "reasoning": "Brief reason"}]

rank 1 = best contact. confidence = 0-100.`

  try {
    const response = await prompt(systemPrompt, userPrompt, provider, model)
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return contacts.map((c, i) => ({ name: c.name, rank: i + 1, confidence: 50, reasoning: '' }))
    return JSON.parse(jsonMatch[0])
  } catch {
    return contacts.map((c, i) => ({ name: c.name, rank: i + 1, confidence: 50, reasoning: '' }))
  }
}

/**
 * Main function: find decision makers at a company.
 */
export async function findContacts(
  companyNameOrUrl: string,
  aiProvider: AIProvider = 'ollama',
  aiModel = 'llama3.2'
): Promise<FoundContact[]> {
  const domain = extractDomain(companyNameOrUrl)
  const companyName = companyNameOrUrl.includes('.')
    ? domain.split('.')[0]
    : companyNameOrUrl

  const rawContacts: Array<{ name: string; title: string; linkedinUrl?: string; source: string }> = []

  // ── Step 1: LinkedIn via Google ──────────────────────────────────────────
  try {
    const linkedinResults = await findLinkedInProfiles(companyName, [
      'Head of Content', 'Content Manager', 'Content Director',
      'Marketing Director', 'VP of Marketing', 'CMO', 'Editor',
      'Founder', 'CEO',
    ])

    for (const r of linkedinResults) {
      const parsed = parseLinkedInResult(r.title, r.snippet)
      if (parsed && TARGET_TITLE_PATTERN.test(parsed.jobTitle)) {
        rawContacts.push({
          name: parsed.name,
          title: parsed.jobTitle,
          linkedinUrl: r.url,
          source: 'linkedin-google',
        })
      }
    }
  } catch {
    // Continue even if Google search fails
  }

  // ── Step 2: Team/About page ──────────────────────────────────────────────
  try {
    const teamPageUrl = await findTeamPage(domain)
    if (teamPageUrl) {
      const teamContacts = await scrapeTeamPage(teamPageUrl)
      for (const c of teamContacts) {
        if (!c.title || TARGET_TITLE_PATTERN.test(c.title)) {
          rawContacts.push({
            name: c.name,
            title: c.title ?? 'Unknown',
            linkedinUrl: c.linkedinUrl,
            source: 'team-page',
          })
        }
      }
    }
  } catch {
    // Continue
  }

  // ── Step 3: Deduplicate ──────────────────────────────────────────────────
  const seen = new Set<string>()
  const unique = rawContacts.filter((c) => {
    const key = c.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (unique.length === 0) return []

  // ── Step 4: AI ranking ───────────────────────────────────────────────────
  const ranked = await rankContactsWithAI(
    unique.map((c) => ({ name: c.name, title: c.title })),
    companyName,
    'freelance writing and content creation',
    aiProvider,
    aiModel
  )

  // ── Step 5: Email finding for top 5 contacts ─────────────────────────────
  const topContacts = ranked.slice(0, 5)
  const results: FoundContact[] = []

  for (const rankedContact of topContacts) {
    const raw = unique.find(
      (c) => c.name.toLowerCase() === rankedContact.name.toLowerCase()
    )
    if (!raw) continue

    const { firstName, lastName } = parseName(raw.name)
    let email: string | null = null
    let emailStatus = 'unverified'

    // Only try email verification if we have both first + last name
    if (firstName && lastName) {
      const guesses = guessEmails(firstName, lastName, domain)
      const topGuesses = guesses.slice(0, 5).map((g) => g.email)

      const verified = await findBestEmail(topGuesses)
      if (verified) {
        email = verified.email
        emailStatus = verified.status
      }
    }

    results.push({
      name: raw.name,
      title: raw.title,
      linkedinUrl: raw.linkedinUrl ?? null,
      email,
      emailStatus,
      confidence: rankedContact.confidence ?? 50,
      rank: rankedContact.rank ?? results.length + 1,
      source: raw.source,
    })
  }

  return results.sort((a, b) => a.rank - b.rank)
}
