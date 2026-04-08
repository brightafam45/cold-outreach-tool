/**
 * Multi-source contact enrichment.
 * Pulls from Hunter.io, GitHub, WHOIS, blog authors, and web scraping.
 * Each source is tried independently and results are merged.
 */

import * as cheerio from 'cheerio'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

export interface EnrichedContact {
  name: string
  title: string | null
  email: string | null
  emailStatus: string
  linkedinUrl: string | null
  twitterUrl: string | null
  confidence: number
  source: string
}

// ─── Hunter.io ───────────────────────────────────────────────────────────────

interface HunterEmail {
  value: string
  type: string
  confidence: number
  first_name: string | null
  last_name: string | null
  position: string | null
  linkedin: string | null
  twitter: string | null
}

/**
 * Hunter.io domain search.
 * Free tier: 25 searches/month. Get key at hunter.io
 * Set HUNTER_API_KEY env var.
 */
export async function hunterSearch(domain: string): Promise<EnrichedContact[]> {
  const apiKey = process.env.HUNTER_API_KEY
  if (!apiKey) return []

  try {
    const res = await fetch(
      `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${apiKey}`,
      { signal: AbortSignal.timeout(10000) }
    )
    if (!res.ok) return []

    const json = await res.json()
    const emails: HunterEmail[] = json?.data?.emails ?? []

    return emails
      .filter((e) => e.first_name || e.last_name)
      .map((e) => ({
        name: [e.first_name, e.last_name].filter(Boolean).join(' '),
        title: e.position,
        email: e.value,
        emailStatus: `verified-hunter`,
        linkedinUrl: e.linkedin,
        twitterUrl: e.twitter,
        confidence: e.confidence ?? 70,
        source: 'hunter.io',
      }))
  } catch {
    return []
  }
}

// ─── GitHub Organization Members ────────────────────────────────────────────

interface GitHubUser {
  login: string
  name: string | null
  email: string | null
  bio: string | null
  blog: string | null
  twitter_username: string | null
  company: string | null
  html_url: string
}

/**
 * Find GitHub org members and their public profile info.
 * Tech companies often have a GitHub org with founders/leads as members.
 * GitHub API is free (60 req/hr unauthenticated, 5000/hr with token).
 */
export async function githubOrgMembers(domain: string): Promise<EnrichedContact[]> {
  // Derive org name from domain (e.g. stripe.com -> stripe)
  const orgName = domain.split('.')[0]
  const token = process.env.GITHUB_TOKEN
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': USER_AGENT,
  }
  if (token) headers['Authorization'] = `token ${token}`

  try {
    // 1. Check if the org exists
    const orgRes = await fetch(`https://api.github.com/orgs/${orgName}/members?per_page=30`, {
      headers,
      signal: AbortSignal.timeout(8000),
    })
    if (!orgRes.ok) return []

    const members: Array<{ login: string; html_url: string }> = await orgRes.json()
    if (!members?.length) return []

    // 2. Fetch profile for each member (up to 10 to stay fast)
    const profileFetches = members.slice(0, 10).map(async (m) => {
      try {
        const pRes = await fetch(`https://api.github.com/users/${m.login}`, {
          headers,
          signal: AbortSignal.timeout(5000),
        })
        if (!pRes.ok) return null
        const p: GitHubUser = await pRes.json()
        return p
      } catch {
        return null
      }
    })

    const profiles = (await Promise.all(profileFetches)).filter(Boolean) as GitHubUser[]

    return profiles
      .filter((p) => p.name) // Only people with real names
      .map((p) => {
        // Try to infer title from bio
        const bio = p.bio ?? ''
        const titleMatch = bio.match(/(CEO|CTO|founder|co-founder|engineer|developer|designer|head of|director|VP|manager)[^,.]*?(?=[,.]|$)/i)
        const title = titleMatch ? titleMatch[0].trim() : null

        return {
          name: p.name!,
          title,
          email: p.email || null,
          emailStatus: p.email ? 'found-github' : 'unavailable',
          linkedinUrl: null,
          twitterUrl: p.twitter_username ? `https://twitter.com/${p.twitter_username}` : null,
          confidence: p.email ? 90 : 45,
          source: 'github',
        }
      })
  } catch {
    return []
  }
}

// ─── WHOIS / RDAP ────────────────────────────────────────────────────────────

/**
 * Look up domain registration contact via RDAP (WHOIS successor).
 * Often has registrant name/email for small companies.
 */
export async function rdapLookup(domain: string): Promise<EnrichedContact[]> {
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []

    const data = await res.json()
    const contacts: EnrichedContact[] = []

    // RDAP entities can be registrant, admin, tech contacts
    const entities = data?.entities ?? []
    for (const entity of entities) {
      const vcardArray = entity?.vcardArray?.[1] ?? []
      let name = ''
      let email = ''
      const roles: string[] = entity?.roles ?? []

      for (const field of vcardArray) {
        if (field[0] === 'fn') name = field[3] as string
        if (field[0] === 'email') email = field[3] as string
      }

      // Skip privacy-protected or generic entries
      if (!name || name.toLowerCase().includes('redacted') || name.toLowerCase().includes('privacy')) continue
      if (!email || email.toLowerCase().includes('redacted') || email.toLowerCase().includes('abuse')) continue

      contacts.push({
        name,
        title: roles.includes('registrant') ? 'Domain Registrant' : 'Contact',
        email,
        emailStatus: 'found-whois',
        linkedinUrl: null,
        twitterUrl: null,
        confidence: 60,
        source: 'whois',
      })
    }

    return contacts
  } catch {
    return []
  }
}

// ─── Blog Author Bylines ─────────────────────────────────────────────────────

/**
 * Extract author names from blog posts.
 * Many blogs list author name + bio which is a goldmine for contact finding.
 */
export async function extractBlogAuthors(
  domain: string,
  blogUrl: string | null
): Promise<EnrichedContact[]> {
  const urls = [
    blogUrl,
    `https://${domain}/blog`,
    `https://blog.${domain}`,
    `https://${domain}/articles`,
    `https://${domain}/resources`,
  ].filter(Boolean) as string[]

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) continue

      const html = await res.text()
      const $ = cheerio.load(html)
      const authors = new Map<string, EnrichedContact>()

      // Author byline patterns
      const authorSelectors = [
        '[class*="author"]',
        '[rel="author"]',
        '.byline',
        '[class*="byline"]',
        '[class*="writer"]',
        '[itemprop="author"]',
      ]

      for (const sel of authorSelectors) {
        $(sel).each((_, el) => {
          const text = $(el).text().trim()
          // Extract name: 2-3 words, title-cased
          const nameMatch = text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2})\b/)
          if (!nameMatch) return

          const name = nameMatch[1].trim()
          // Skip generic words
          if (/^(The|By|Via|From|Team|Staff|Editor|Author|Guest|Written|Posted)/.test(name)) return
          if (name.split(' ').length < 2) return

          if (!authors.has(name)) {
            // Try to find their LinkedIn or email in nearby elements
            const parent = $(el).closest('article, .post, [class*="blog"], section').first()
            const linkedinUrl = parent.find('a[href*="linkedin.com/in"]').first().attr('href') ?? null

            // Extract any title hint near the author name
            const titleEl = parent.find('[class*="title"], [class*="role"], [class*="position"]').first()
            const title = titleEl.text().trim() || null

            authors.set(name, {
              name,
              title: title && title.length < 80 ? title : null,
              email: null,
              emailStatus: 'unavailable',
              linkedinUrl: linkedinUrl ?? null,
              twitterUrl: null,
              confidence: 40,
              source: 'blog-author',
            })
          }
        })
      }

      if (authors.size > 0) return [...authors.values()].slice(0, 5)
    } catch {
      continue
    }
  }

  return []
}

// ─── LinkedIn via Web (DuckDuckGo/Bing cache) ────────────────────────────────

/**
 * Search for LinkedIn profiles via DuckDuckGo HTML search.
 * DuckDuckGo is more permissive than Google/Bing for cloud IPs.
 */
export async function linkedinViaDDG(
  companyName: string,
  titles: string[]
): Promise<EnrichedContact[]> {
  const titleQuery = titles.slice(0, 3).map(t => `"${t}"`).join(' OR ')
  const query = `site:linkedin.com/in "${companyName}" (${titleQuery})`

  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) return []

    const html = await res.text()
    const $ = cheerio.load(html)
    const contacts: EnrichedContact[] = []

    $('.result__title, .result__snippet').each((_, el) => {
      const text = $(el).text().trim()
      const href = $(el).find('a').attr('href') ?? $(el).closest('.result').find('.result__url').text().trim()

      // Parse "Name - Title at Company | LinkedIn" format
      const nameMatch = text.match(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)\s*[-–|]/)
      const titleMatch = text.match(/[-–|]\s*(.+?)(?:\s+at\s+|\s*[-–|]\s*LinkedIn|\s*\|)/i)

      if (nameMatch && href?.includes('linkedin.com/in')) {
        contacts.push({
          name: nameMatch[1].trim(),
          title: titleMatch?.[1]?.trim() ?? null,
          email: null,
          emailStatus: 'unavailable',
          linkedinUrl: href.startsWith('http') ? href : null,
          twitterUrl: null,
          confidence: 55,
          source: 'linkedin-ddg',
        })
      }
    })

    return contacts.slice(0, 8)
  } catch {
    return []
  }
}

// ─── Crunchbase People ───────────────────────────────────────────────────────

/**
 * Scrape Crunchbase public company page for founders/executives.
 * No API key needed for basic data.
 */
export async function crunchbasePeople(companyName: string): Promise<EnrichedContact[]> {
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  try {
    const res = await fetch(
      `https://www.crunchbase.com/organization/${slug}/people`,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) return []

    const html = await res.text()
    const $ = cheerio.load(html)
    const contacts: EnrichedContact[] = []

    // Crunchbase JSON-LD data often contains person info
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() ?? '{}')
        if (data['@type'] === 'Person' || data.name) {
          contacts.push({
            name: data.name,
            title: data.jobTitle ?? null,
            email: null,
            emailStatus: 'unavailable',
            linkedinUrl: null,
            twitterUrl: null,
            confidence: 60,
            source: 'crunchbase',
          })
        }
      } catch { /* skip */ }
    })

    return contacts.slice(0, 5)
  } catch {
    return []
  }
}

// ─── Email Pattern Guesser (enhanced) ────────────────────────────────────────

export interface EmailGuess {
  email: string
  pattern: string
  confidence: number
}

/**
 * Generate email guesses based on name + domain.
 * Tries to infer the company's email pattern from known emails first.
 */
export function generateEmailGuesses(
  firstName: string,
  lastName: string,
  domain: string,
  knownEmails: string[] = []
): EmailGuess[] {
  const fn = firstName.toLowerCase().replace(/[^a-z]/g, '')
  const ln = lastName.toLowerCase().replace(/[^a-z]/g, '')
  if (!fn || !ln) return []

  // If we have known emails, infer the pattern
  if (knownEmails.length > 0) {
    for (const known of knownEmails) {
      const local = known.split('@')[0]
      const knownDomain = known.split('@')[1]
      if (knownDomain !== domain) continue

      // Detect pattern from known email local part
      // fn.ln, fn, fln, fnl, etc.
      if (local.includes('.')) {
        const parts = local.split('.')
        if (parts.length === 2) {
          // Could be first.last or last.first
          if (parts[0].length > 2) {
            // Probably firstname.lastname pattern
            return [{ email: `${fn}.${ln}@${domain}`, pattern: 'first.last', confidence: 78 }]
          }
        }
      } else if (local.length <= 4 && local[0] === local[0]) {
        // Short — probably first initial + last
        return [{ email: `${fn[0]}${ln}@${domain}`, pattern: 'flast', confidence: 75 }]
      } else if (local.includes('-')) {
        return [{ email: `${fn}-${ln}@${domain}`, pattern: 'first-last', confidence: 73 }]
      }
    }
  }

  // Default patterns ordered by global prevalence
  return [
    { email: `${fn}.${ln}@${domain}`, pattern: 'first.last', confidence: 55 },
    { email: `${fn}@${domain}`, pattern: 'first', confidence: 45 },
    { email: `${fn[0]}${ln}@${domain}`, pattern: 'flast', confidence: 50 },
    { email: `${fn}${ln}@${domain}`, pattern: 'firstlast', confidence: 40 },
    { email: `${fn}${ln[0]}@${domain}`, pattern: 'firstl', confidence: 35 },
    { email: `${fn}-${ln}@${domain}`, pattern: 'first-last', confidence: 35 },
  ]
}
