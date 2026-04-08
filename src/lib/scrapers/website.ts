/**
 * Company website scraper.
 * Scrapes team pages, about pages, blogs, and contact pages.
 */

import * as cheerio from 'cheerio'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

// Common team/about page URL patterns to probe
const TEAM_PAGE_PATHS = [
  '/about',
  '/about-us',
  '/team',
  '/our-team',
  '/people',
  '/leadership',
  '/company',
  '/company/team',
  '/company/about',
  '/who-we-are',
  '/about/team',
  '/staff',
  '/management',
  '/founders',
  '/the-team',
  '/meet-the-team',
]

export interface RawContact {
  name: string
  title?: string
  linkedinUrl?: string
  source: string
}

export interface BlogPost {
  title: string
  url: string
  date?: string
  excerpt?: string
}

/**
 * Fetch HTML from a URL. Returns null on failure.
 */
async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.text()
}

async function fetchHtmlSafe(url: string): Promise<string | null> {
  try {
    return await fetchHtml(url)
  } catch {
    return null
  }
}

/**
 * Extract email addresses from HTML content.
 * Finds mailto: links and email patterns in text.
 */
export function extractEmailsFromHtml(html: string, domain: string): string[] {
  const emails = new Set<string>()
  const $ = cheerio.load(html)

  // Extract mailto: links
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const email = href.replace('mailto:', '').split('?')[0].trim().toLowerCase()
    if (email && email.includes('@') && isValidEmail(email)) {
      emails.add(email)
    }
  })

  // Extract email patterns from page text
  const text = $.text()
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  const matches = text.match(emailPattern) ?? []
  for (const match of matches) {
    const email = match.toLowerCase()
    if (isValidEmail(email) && !email.includes('example') && !email.includes('placeholder')) {
      emails.add(email)
    }
  }

  // Prioritize emails from the target domain
  const domainEmails = [...emails].filter((e) => e.endsWith(`@${domain}`) || e.endsWith(`@${domain.replace(/^www\./, '')}`))
  const otherEmails = [...emails].filter((e) => !domainEmails.includes(e))

  return [...domainEmails, ...otherEmails].slice(0, 10)
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length < 100
}

/**
 * Probe multiple team page URL patterns in parallel.
 * Returns the first URL that responds with useful content.
 */
export async function probeTeamPages(domain: string): Promise<{ url: string; html: string } | null> {
  const urls = TEAM_PAGE_PATHS.map((path) => `https://${domain}${path}`)

  // Try all in parallel, take first successful one with person-like content
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const html = await fetchHtmlSafe(url)
      if (!html) throw new Error('no content')
      // Check if page has person-like content
      const hasPersonContent = /\b(CEO|founder|director|manager|head of|marketing|content|editor)\b/i.test(html)
        || /[A-Z][a-z]+ [A-Z][a-z]+/.test(html) // Has name-like patterns
      if (!hasPersonContent) throw new Error('no person content')
      return { url, html }
    })
  )

  for (const r of results) {
    if (r.status === 'fulfilled') return r.value
  }

  return null
}

/**
 * Extract domain from URL or company name input.
 */
export function extractDomain(input: string): string {
  try {
    const url = input.startsWith('http') ? input : `https://${input}`
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    // Treat as company name — convert to likely domain
    return input.toLowerCase().replace(/\s+/g, '') + '.com'
  }
}

/**
 * Extract all people from a team or about page.
 * Looks for name + title patterns in common HTML structures.
 */
export async function scrapeTeamPage(url: string): Promise<RawContact[]> {
  const html = await fetchHtml(url)
  const $ = cheerio.load(html)
  const contacts: RawContact[] = []

  // Common patterns: cards, list items, sections with person names
  const selectors = [
    '.team-member',
    '.person',
    '.member',
    '.staff',
    '.employee',
    '[class*="team"]',
    '[class*="person"]',
    '[class*="member"]',
    '[class*="staff"]',
    '[class*="people"]',
    'article',
    '.card',
  ]

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const text = $(el).text()

      // Name heuristic: 2-4 words, title-cased, within 50 chars
      const nameMatch = text.match(/^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/m)
      // Title heuristic: keywords after name
      const titleMatch = text.match(
        /(CEO|CTO|CMO|COO|Director|Manager|Head|Lead|Editor|Writer|Content|Marketing|Founder|VP|President)[^\n]{0,60}/i
      )

      const linkedinEl = $(el).find('a[href*="linkedin.com"]')
      const linkedinUrl = linkedinEl.attr('href') ?? undefined

      if (nameMatch) {
        contacts.push({
          name: nameMatch[1].trim(),
          title: titleMatch?.[0]?.trim(),
          linkedinUrl,
          source: url,
        })
      }
    })

    if (contacts.length >= 20) break
  }

  // Deduplicate by name
  const seen = new Set<string>()
  return contacts.filter((c) => {
    if (seen.has(c.name)) return false
    seen.add(c.name)
    return true
  })
}

/**
 * Scrape a company's blog for recent posts.
 */
export async function scrapeBlog(blogUrl: string): Promise<BlogPost[]> {
  const html = await fetchHtml(blogUrl)
  const $ = cheerio.load(html)
  const posts: BlogPost[] = []

  // Common blog post patterns
  const selectors = ['article', '.post', '.blog-post', '[class*="post"]', '[class*="article"]', 'li']

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const titleEl = $(el).find('h1, h2, h3').first()
      const linkEl = $(el).find('a').first()
      const excerptEl = $(el).find('p').first()
      const dateEl = $(el).find('time, [class*="date"]').first()

      const title = titleEl.text().trim()
      const href = linkEl.attr('href')
      const excerpt = excerptEl.text().trim()
      const date = dateEl.attr('datetime') ?? dateEl.text().trim()

      if (title && href && title.length > 10 && title.length < 200) {
        const url = href.startsWith('http')
          ? href
          : `https://${blogUrl.replace(/^https?:\/\//, '').split('/')[0]}${href}`

        posts.push({ title, url, date: date || undefined, excerpt: excerpt || undefined })
      }
    })

    if (posts.length >= 15) break
  }

  // Deduplicate
  const seen = new Set<string>()
  return posts
    .filter((p) => {
      if (seen.has(p.title)) return false
      seen.add(p.title)
      return true
    })
    .slice(0, 15)
}

/**
 * Scrape a company's homepage for general signals.
 * Returns: description, industry hints, social links.
 */
export async function scrapeHomepage(domain: string): Promise<{
  description: string
  keywords: string[]
  twitterUrl?: string
  linkedinUrl?: string
}> {
  const url = `https://${domain}`
  const html = await fetchHtml(url)
  const $ = cheerio.load(html)

  const description =
    $('meta[name="description"]').attr('content') ??
    $('meta[property="og:description"]').attr('content') ??
    $('p').first().text().trim().slice(0, 300)

  const keywords = ($('meta[name="keywords"]').attr('content') ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)

  const twitterUrl =
    $('a[href*="twitter.com"], a[href*="x.com"]').first().attr('href') ??
    undefined
  const linkedinUrl =
    $('a[href*="linkedin.com/company"]').first().attr('href') ?? undefined

  return { description, keywords, twitterUrl, linkedinUrl }
}
