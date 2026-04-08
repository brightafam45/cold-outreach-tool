/**
 * Bing Search scraper.
 * Bing is more permissive than Google for cloud server IPs.
 */

import * as cheerio from 'cheerio'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/**
 * Search Bing and return results.
 */
export async function bingSearch(
  query: string,
  limit = 10
): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query)
  const url = `https://www.bing.com/search?q=${encoded}&count=${limit}`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return []

    const html = await res.text()
    const $ = cheerio.load(html)
    const results: SearchResult[] = []

    $('li.b_algo').each((_, el) => {
      const titleEl = $(el).find('h2 a').first()
      const snippetEl = $(el).find('.b_caption p, .b_algoSlug').first()

      const title = titleEl.text().trim()
      const href = titleEl.attr('href') ?? ''
      const snippet = snippetEl.text().trim()

      if (title && href.startsWith('http')) {
        results.push({ title, url: href, snippet })
      }
    })

    return results.slice(0, limit)
  } catch {
    return []
  }
}

/**
 * Find LinkedIn profiles for a company using Bing.
 */
export async function findLinkedInProfiles(
  companyName: string,
  roleKeywords: string[]
): Promise<SearchResult[]> {
  const roles = roleKeywords.slice(0, 4).map((r) => `"${r}"`).join(' OR ')
  const query = `site:linkedin.com/in "${companyName}" (${roles})`
  return bingSearch(query, 10)
}

/**
 * Find a company's blog URL using Bing.
 */
export async function findBlogUrl(companyDomain: string): Promise<string | null> {
  const query = `site:${companyDomain} blog`
  const results = await bingSearch(query, 5)

  for (const r of results) {
    if (r.url.toLowerCase().includes('blog')) return r.url
  }

  // Try common blog URL patterns
  const blogPatterns = [
    `https://${companyDomain}/blog`,
    `https://blog.${companyDomain}`,
    `https://${companyDomain}/articles`,
    `https://${companyDomain}/resources`,
  ]

  return blogPatterns[0] // Return most likely pattern as fallback
}
