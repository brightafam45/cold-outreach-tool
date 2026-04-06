/**
 * Company website scraper.
 * Scrapes team pages, about pages, blogs, and contact pages.
 */

import * as cheerio from 'cheerio'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

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
 * Fetch HTML from a URL.
 */
async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.text()
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
