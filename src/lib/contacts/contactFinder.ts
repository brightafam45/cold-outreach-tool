/**
 * Contact finder — the core engine.
 * Uses Bing search + direct website probing to find decision makers.
 * No Google (blocked on cloud IPs), no SMTP verification (blocked on Vercel).
 */

import { findLinkedInProfiles } from '@/lib/scrapers/bing'
import { scrapeTeamPage, probeTeamPages, extractEmailsFromHtml, extractDomain, type RawContact } from '@/lib/scrapers/website'
import { guessEmails, parseName } from '@/lib/contacts/emailGuesser'
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
  'CEO',
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

export interface WriterProfile {
  niches?: string
  contentTypes?: string
  writingStyle?: string
  bio?: string
}

/**
 * Extract name and title from a LinkedIn search result.
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
 * Guess email address based on common patterns, without SMTP verification.
 * Returns the most likely pattern with a confidence score.
 */
function guessEmailWithConfidence(
  firstName: string,
  lastName: string,
  domain: string,
  knownEmails: string[]
): { email: string; status: string; confidence: number } | null {
  if (!firstName || !lastName) return null

  const fn = firstName.toLowerCase()
  const ln = lastName.toLowerCase()

  // Email patterns ordered by prevalence
  const patterns = [
    { email: `${fn}@${domain}`, confidence: 45 },
    { email: `${fn}.${ln}@${domain}`, confidence: 55 },
    { email: `${fn[0]}${ln}@${domain}`, confidence: 50 },
    { email: `${fn}${ln}@${domain}`, confidence: 40 },
    { email: `${fn}${ln[0]}@${domain}`, confidence: 35 },
  ]

  // If we found real emails on the site, check if the pattern matches
  if (knownEmails.length > 0) {
    for (const known of knownEmails) {
      // Check if this person's name parts appear in a known email
      if (known.includes(fn) || known.includes(ln)) {
        return { email: known, status: 'found-on-site', confidence: 80 }
      }
    }

    // Infer pattern from known emails
    const sample = knownEmails[0]
    const localPart = sample.split('@')[0]
    if (localPart.includes('.')) {
      return { email: `${fn}.${ln}@${domain}`, status: 'pattern-inferred', confidence: 65 }
    } else if (localPart.length <= 4) {
      return { email: `${fn[0]}${ln}@${domain}`, status: 'pattern-inferred', confidence: 60 }
    }
  }

  return { email: patterns[0].email, status: 'guessed', confidence: patterns[0].confidence }
}

/**
 * Use AI to rank contacts and identify the best fit.
 */
async function rankContactsWithAI(
  contacts: Array<{ name: string; title: string }>,
  companyName: string,
  writerProfile: WriterProfile,
  provider: AIProvider,
  model: string
): Promise<Array<{ name: string; rank: number; confidence: number; reasoning: string }>> {
  if (contacts.length === 0) return []

  const profileContext = writerProfile.niches
    ? `The writer specializes in ${writerProfile.niches}.`
    : 'The writer is a freelance content writer.'

  const systemPrompt = `You are an expert at B2B outreach. Your job is to rank contacts at a company by how likely they are to respond to a cold outreach from a freelance content writer.`

  const userPrompt = `I want to reach out to ${companyName} about freelance writing/content work.
${profileContext}

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
  aiProvider: AIProvider = 'groq',
  aiModel = 'llama-3.3-70b-versatile',
  options: { skipEmailVerification?: boolean; writerProfile?: WriterProfile } = {}
): Promise<FoundContact[]> {
  const domain = extractDomain(companyNameOrUrl)
  const companyName = companyNameOrUrl.includes('.')
    ? domain.split('.')[0]
    : companyNameOrUrl

  const rawContacts: Array<{ name: string; title: string; linkedinUrl?: string; source: string }> = []

  // ── Step 1 & 2: LinkedIn via Bing + direct team page probing (parallel) ───
  const [linkedinResults, teamPageResult] = await Promise.all([
    findLinkedInProfiles(companyName, [
      'Head of Content', 'Content Manager', 'Content Director',
      'Marketing Director', 'VP of Marketing', 'CMO', 'Editor',
      'Founder', 'CEO',
    ]).catch(() => []),
    probeTeamPages(domain).catch(() => null),
  ])

  // Process LinkedIn results from Bing
  for (const r of linkedinResults) {
    const parsed = parseLinkedInResult(r.title, r.snippet)
    if (parsed && TARGET_TITLE_PATTERN.test(parsed.jobTitle)) {
      rawContacts.push({
        name: parsed.name,
        title: parsed.jobTitle,
        linkedinUrl: r.url,
        source: 'linkedin-bing',
      })
    }
  }

  // Extract emails from found pages
  let siteEmails: string[] = []
  if (teamPageResult) {
    try {
      const teamContacts = await scrapeTeamPage(teamPageResult.url)
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
      // Extract emails from team page HTML
      siteEmails = extractEmailsFromHtml(teamPageResult.html, domain)
    } catch { /* continue */ }
  }

  // Also check homepage for emails (contact page patterns)
  try {
    const contactPageUrls = [
      `https://${domain}/contact`,
      `https://${domain}/contact-us`,
      `https://${domain}/hello`,
    ]
    // Try first contact page
    const contactRes = await fetch(contactPageUrls[0], {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      signal: AbortSignal.timeout(5000),
    })
    if (contactRes.ok) {
      const html = await contactRes.text()
      const contactEmails = extractEmailsFromHtml(html, domain)
      siteEmails = [...new Set([...siteEmails, ...contactEmails])]
    }
  } catch { /* ignore */ }

  // ── Step 3: Deduplicate ──────────────────────────────────────────────────
  const seen = new Set<string>()
  const unique = rawContacts.filter((c) => {
    const key = c.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // If no contacts found via scraping/LinkedIn, create placeholders from emails
  if (unique.length === 0 && siteEmails.length > 0) {
    // We have emails but no names — create minimal contacts
    for (const email of siteEmails.slice(0, 3)) {
      const localPart = email.split('@')[0]
      // Skip generic emails
      if (/^(info|hello|contact|support|admin|mail|team|sales|marketing)$/i.test(localPart)) continue
      unique.push({
        name: localPart.replace(/[._-]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        title: 'Team Member',
        source: 'site-email',
      })
    }
  }

  if (unique.length === 0) return []

  // ── Step 4: AI ranking ───────────────────────────────────────────────────
  const ranked = await rankContactsWithAI(
    unique.map((c) => ({ name: c.name, title: c.title })),
    companyName,
    options.writerProfile ?? {},
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
    let emailStatus = 'unavailable'
    let contactConfidence = rankedContact.confidence ?? 50

    // Try to find email (no SMTP — just pattern/site-based)
    if (firstName && lastName) {
      const emailGuess = guessEmailWithConfidence(firstName, lastName, domain, siteEmails)
      if (emailGuess) {
        email = emailGuess.email
        emailStatus = emailGuess.status
        // Boost confidence if email was found on site
        if (emailGuess.status === 'found-on-site') {
          contactConfidence = Math.max(contactConfidence, emailGuess.confidence)
        }
      }
    } else if (raw.source === 'site-email') {
      // The "name" was derived from an email address — reconstruct it
      const matchedEmail = siteEmails.find((e) =>
        e.split('@')[0].toLowerCase().includes(firstName?.toLowerCase() ?? '')
      )
      if (matchedEmail) {
        email = matchedEmail
        emailStatus = 'found-on-site'
        contactConfidence = 75
      }
    }

    results.push({
      name: raw.name,
      title: raw.title,
      linkedinUrl: raw.linkedinUrl ?? null,
      email,
      emailStatus,
      confidence: contactConfidence,
      rank: rankedContact.rank ?? results.length + 1,
      source: raw.source,
    })
  }

  return results.sort((a, b) => a.rank - b.rank)
}
