/**
 * Contact finder — multi-source pipeline.
 *
 * Sources tried in parallel:
 *   1. Hunter.io API     (best — needs free API key in HUNTER_API_KEY env var)
 *   2. GitHub org        (great for tech companies — free)
 *   3. DuckDuckGo        (LinkedIn search — free, less blocked than Google)
 *   4. Direct website    (team page probing + email extraction)
 *   5. Blog authors      (bylines from blog posts)
 *   6. WHOIS/RDAP        (domain registrant — good for small companies)
 *   7. Crunchbase        (founder/exec info)
 *
 * Results are merged, deduplicated, ranked by AI, and top 5 returned.
 */

import {
  hunterSearch,
  githubOrgMembers,
  rdapLookup,
  extractBlogAuthors,
  linkedinSearch,
  crunchbasePeople,
  generateEmailGuesses,
  type EnrichedContact,
} from './enrichment'
import { probeTeamPages, extractEmailsFromHtml, extractDomain } from '@/lib/scrapers/website'
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
  'Chief Executive',
]

const TARGET_TITLE_PATTERN = new RegExp(
  TARGET_TITLES.map((t) => t.replace(/\s+/g, '\\s*')).join('|'),
  'i'
)

export interface FoundContact {
  name: string
  title: string
  linkedinUrl: string | null
  twitterUrl?: string | null
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
 * Use AI to rank contacts by fit for content writer outreach.
 */
async function rankContacts(
  contacts: Array<{ name: string; title: string }>,
  companyName: string,
  writerNiche: string,
  provider: AIProvider,
  model: string
): Promise<Array<{ name: string; rank: number; confidence: number }>> {
  if (contacts.length === 0) return []

  const systemPrompt = `You rank contacts at a company by how likely they are to respond to a cold pitch from a freelance content writer who specializes in ${writerNiche || 'B2B/SaaS content'}.`

  const userPrompt = `Company: ${companyName}

Contacts found:
${contacts.map((c, i) => `${i + 1}. ${c.name} — ${c.title || 'Unknown title'}`).join('\n')}

Rank from most to least suitable to receive a cold outreach from a freelance writer. Consider:
- Content/marketing roles hire writers directly
- For small companies, founders often make these decisions
- Generic titles (Engineer, Sales) are lower priority

Return ONLY a JSON array:
[{"name":"...","rank":1,"confidence":80}]`

  try {
    const response = await prompt(systemPrompt, userPrompt, provider, model)
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return contacts.map((c, i) => ({ name: c.name, rank: i + 1, confidence: 50 }))
    return JSON.parse(jsonMatch[0])
  } catch {
    return contacts.map((c, i) => ({ name: c.name, rank: i + 1, confidence: 50 }))
  }
}

/**
 * Scrape team page and extract emails + contacts from site directly.
 */
async function scrapeWebsite(domain: string): Promise<{ contacts: EnrichedContact[]; siteEmails: string[] }> {
  const contacts: EnrichedContact[] = []
  let siteEmails: string[] = []

  // Probe team/about pages
  const teamResult = await probeTeamPages(domain).catch(() => null)
  if (teamResult) {
    siteEmails = extractEmailsFromHtml(teamResult.html, domain)

    // Extract contact names from HTML
    const $ = await import('cheerio').then(c => c.load(teamResult.html))
    const namePattern = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2})\b/

    const selectors = [
      '[class*="team"]', '[class*="person"]', '[class*="member"]',
      '[class*="people"]', '[class*="staff"]', '[class*="employee"]',
      '.card', 'article',
    ]

    const seen = new Set<string>()
    for (const sel of selectors) {
      $(sel).each((_, el) => {
        const text = $(el).text()
        const nameMatch = text.match(namePattern)
        const titleMatch = text.match(
          /(CEO|CTO|CMO|COO|Director|Manager|Head|Lead|Editor|Writer|Content|Marketing|Founder|VP|President|Co-Founder)[^\n]{0,60}/i
        )
        const linkedinEl = $(el).find('a[href*="linkedin.com/in"]').first()
        const linkedinUrl = linkedinEl.attr('href') ?? null

        if (nameMatch && !seen.has(nameMatch[1])) {
          seen.add(nameMatch[1])
          contacts.push({
            name: nameMatch[1].trim(),
            title: titleMatch?.[0]?.trim() ?? null,
            email: null,
            emailStatus: 'unavailable',
            linkedinUrl,
            twitterUrl: null,
            confidence: 50,
            source: 'team-page',
          })
        }
      })
      if (contacts.length >= 15) break
    }
  }

  // Also check homepage for emails
  try {
    const res = await fetch(`https://${domain}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const html = await res.text()
      const moreEmails = extractEmailsFromHtml(html, domain)
      siteEmails = [...new Set([...siteEmails, ...moreEmails])]
    }
  } catch { /* ignore */ }

  // Try contact page too
  try {
    const contactRes = await fetch(`https://${domain}/contact`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      signal: AbortSignal.timeout(5000),
    })
    if (contactRes.ok) {
      const html = await contactRes.text()
      const contactEmails = extractEmailsFromHtml(html, domain)
      siteEmails = [...new Set([...siteEmails, ...contactEmails])]
    }
  } catch { /* ignore */ }

  return { contacts, siteEmails }
}

/**
 * Main function: find decision makers at a company.
 * Runs all sources in parallel and merges results.
 */
export async function findContacts(
  companyNameOrUrl: string,
  aiProvider: AIProvider = 'groq',
  aiModel = 'llama-3.3-70b-versatile',
  options: { writerProfile?: WriterProfile } = {}
): Promise<FoundContact[]> {
  const domain = extractDomain(companyNameOrUrl)
  // Best-effort company name from domain
  const companyName = domain
    .split('.')[0]
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase())

  // ── Run all sources in parallel ──────────────────────────────────────────
  const [
    hunterContacts,
    githubContacts,
    ddgContacts,
    whoisContacts,
    blogAuthorContacts,
    crunchbaseContacts,
    { contacts: siteContacts, siteEmails },
  ] = await Promise.all([
    hunterSearch(domain).catch(() => []),                          // best — needs free API key
    githubOrgMembers(domain).catch(() => []),                       // free, unlimited
    linkedinSearch(companyName, domain, TARGET_TITLES).catch(() => []), // free, unlimited
    rdapLookup(domain).catch(() => []),                             // free, unlimited
    extractBlogAuthors(domain, null).catch(() => []),               // free, unlimited
    crunchbasePeople(companyName).catch(() => []),                  // free, unlimited
    scrapeWebsite(domain).catch(() => ({ contacts: [], siteEmails: [] })), // free, unlimited
  ])

  // ── Merge all sources ────────────────────────────────────────────────────
  const allRaw: EnrichedContact[] = [
    ...hunterContacts,         // highest quality — has real emails
    ...githubContacts,         // good for tech companies
    ...ddgContacts,            // LinkedIn profiles
    ...siteContacts,           // team page scraping
    ...blogAuthorContacts,     // blog bylines
    ...whoisContacts,          // domain registrant
    ...crunchbaseContacts,     // founders/execs
  ]

  // ── Deduplicate by name (case-insensitive) ───────────────────────────────
  const seen = new Map<string, EnrichedContact>()
  for (const contact of allRaw) {
    if (!contact.name || contact.name.split(' ').length < 2) continue
    const key = contact.name.toLowerCase().replace(/\s+/g, ' ').trim()

    if (!seen.has(key)) {
      seen.set(key, contact)
    } else {
      // Merge: prefer entry with email, higher confidence
      const existing = seen.get(key)!
      if (!existing.email && contact.email) {
        seen.set(key, { ...existing, email: contact.email, emailStatus: contact.emailStatus, source: `${existing.source}+${contact.source}` })
      }
      if (contact.linkedinUrl && !existing.linkedinUrl) {
        seen.get(key)!.linkedinUrl = contact.linkedinUrl
      }
      if (contact.title && !existing.title) {
        seen.get(key)!.title = contact.title
      }
    }
  }

  let unique = [...seen.values()]

  // Filter to target titles where we can
  const targeted = unique.filter((c) => !c.title || TARGET_TITLE_PATTERN.test(c.title))
  // If no targeted, keep all (better to have some contacts than none)
  if (targeted.length > 0) unique = targeted

  if (unique.length === 0) {
    // Last resort: if we found emails on site, create minimal entries for non-generic ones
    const personalEmails = siteEmails.filter(
      (e) => !/^(info|hello|contact|support|admin|mail|team|sales|marketing|press|media|billing|legal|privacy|security|careers|jobs|feedback|noreply|no-reply)@/.test(e)
    )
    for (const email of personalEmails.slice(0, 3)) {
      const local = email.split('@')[0]
      const name = local
        .replace(/[._-]/g, ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase())
      if (name.split(' ').length >= 2) {
        unique.push({
          name,
          title: null,
          email,
          emailStatus: 'found-on-site',
          linkedinUrl: null,
          twitterUrl: null,
          confidence: 65,
          source: 'site-email',
        })
      }
    }
  }

  if (unique.length === 0) return []

  // ── AI ranking ───────────────────────────────────────────────────────────
  const ranked = await rankContacts(
    unique.map((c) => ({ name: c.name, title: c.title ?? 'Unknown' })),
    companyName,
    options.writerProfile?.niches ?? 'B2B/SaaS content',
    aiProvider,
    aiModel
  )

  // ── Fill in emails for top contacts using pattern inference ───────────────
  const topContacts = ranked.slice(0, 5)
  const results: FoundContact[] = []

  for (const ranked of topContacts) {
    const raw = unique.find(
      (c) => c.name.toLowerCase().trim() === ranked.name.toLowerCase().trim()
    )
    if (!raw) continue

    let { email, emailStatus, confidence } = raw

    // If no email yet, try to guess based on site patterns
    if (!email) {
      const nameParts = raw.name.split(' ')
      const firstName = nameParts[0]
      const lastName = nameParts[nameParts.length - 1]

      if (firstName && lastName && firstName !== lastName) {
        const guesses = generateEmailGuesses(firstName, lastName, domain, siteEmails)
        if (guesses.length > 0) {
          email = guesses[0].email
          emailStatus = guesses[0].pattern === 'first.last' && siteEmails.length > 0
            ? 'pattern-inferred'
            : 'guessed'
          confidence = Math.min(confidence, guesses[0].confidence)
        }
      }
    }

    results.push({
      name: raw.name,
      title: raw.title ?? 'Team Member',
      linkedinUrl: raw.linkedinUrl,
      twitterUrl: raw.twitterUrl,
      email,
      emailStatus,
      confidence: ranked.confidence ?? confidence,
      rank: ranked.rank ?? results.length + 1,
      source: raw.source,
    })
  }

  return results.sort((a, b) => a.rank - b.rank)
}
