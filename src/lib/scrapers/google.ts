/**
 * Google Search scraper.
 * Uses public Google search (no API key).
 * Adds delays to avoid rate limiting.
 */

import * as cheerio from 'cheerio'

const DELAY_MS = 2000 // 2s between requests — respectful scraping

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomDelay() {
  // Randomise between 1.5s–3.5s to avoid pattern detection
  return sleep(DELAY_MS + Math.random() * 1500)
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
]

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/**
 * Scrape Google search results for a query.
 * Returns up to `limit` results.
 */
export async function googleSearch(
  query: string,
  limit = 10
): Promise<SearchResult[]> {
  await randomDelay()

  const encoded = encodeURIComponent(query)
  const url = `https://www.google.com/search?q=${encoded}&num=${limit}`

  const res = await fetch(url, {
    headers: {
      'User-Agent': randomUserAgent(),
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  })

  if (!res.ok) {
    throw new Error(`Google search failed: ${res.status}`)
  }

  const html = await res.text()
  const $ = cheerio.load(html)
  const results: SearchResult[] = []

  // Google result containers
  $('div.g, div[data-hveid]').each((_, el) => {
    const titleEl = $(el).find('h3').first()
    const linkEl = $(el).find('a').first()
    const snippetEl = $(el).find('[data-sncf], .VwiC3b, span.aCOpRe').first()

    const title = titleEl.text().trim()
    const href = linkEl.attr('href') ?? ''
    const snippet = snippetEl.text().trim()

    // Filter out Google internal links
    if (title && href.startsWith('http') && !href.includes('google.com')) {
      results.push({ title, url: href, snippet })
    }
  })

  return results.slice(0, limit)
}

/**
 * Find LinkedIn profiles for a given company and role keywords.
 * Uses Google: site:linkedin.com/in "Company" "title keyword"
 */
export async function findLinkedInProfiles(
  companyName: string,
  roleKeywords: string[]
): Promise<SearchResult[]> {
  const roles = roleKeywords.map((r) => `"${r}"`).join(' OR ')
  const query = `site:linkedin.com/in "${companyName}" (${roles})`
  return googleSearch(query, 10)
}

/**
 * Find a company's team/about page URL.
 */
export async function findTeamPage(
  companyDomain: string
): Promise<string | null> {
  const query = `site:${companyDomain} (team OR about OR people OR "our team" OR "meet the team")`
  const results = await googleSearch(query, 5)

  for (const r of results) {
    const path = r.url.toLowerCase()
    if (
      path.includes('/about') ||
      path.includes('/team') ||
      path.includes('/people') ||
      path.includes('/company')
    ) {
      return r.url
    }
  }

  return results[0]?.url ?? null
}

/**
 * Find company blog URL.
 */
export async function findBlogUrl(
  companyDomain: string
): Promise<string | null> {
  const query = `site:${companyDomain} blog`
  const results = await googleSearch(query, 5)

  for (const r of results) {
    if (r.url.toLowerCase().includes('blog')) return r.url
  }

  return null
}

/**
 * Find competitors of a company in a given industry.
 */
export async function findCompetitors(
  companyName: string,
  industry: string
): Promise<string[]> {
  const query = `top competitors of "${companyName}" ${industry} 2024 2025`
  const results = await googleSearch(query, 5)

  // Extract competitor names from snippets using a simple pattern
  const names: string[] = []
  for (const r of results) {
    const text = r.snippet + ' ' + r.title
    // Pull out company names that appear in "vs", "competitor", "alternative" contexts
    const matches = text.match(/(?:vs\.?\s+|competitor[s]?:\s*|alternative[s]?:\s*)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g)
    if (matches) {
      matches.forEach((m) => {
        const name = m.replace(/^(vs\.?\s+|competitor[s]?:\s*|alternative[s]?:\s*)/i, '').trim()
        if (name && name !== companyName) names.push(name)
      })
    }
  }

  return [...new Set(names)].slice(0, 5)
}
