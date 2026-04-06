/**
 * Job board scraper.
 * Finds companies actively hiring content writers / copywriters.
 * Scrapes: WeWorkRemotely, Remotive, and Google Jobs.
 * No API keys needed.
 */

import * as cheerio from 'cheerio'

export interface JobListing {
  company: string
  companyUrl: string | null
  jobTitle: string
  jobUrl: string
  location: string
  postedAt: string | null
  snippet: string
  source: string
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) throw new Error(`Failed: ${url} — ${res.status}`)
  return res.text()
}

/**
 * Scrape WeWorkRemotely for writing jobs.
 */
async function scrapeWeWorkRemotely(keyword: string): Promise<JobListing[]> {
  const slug = encodeURIComponent(keyword)
  const url = `https://weworkremotely.com/remote-jobs/search?term=${slug}`
  const html = await fetchHtml(url)
  const $ = cheerio.load(html)
  const results: JobListing[] = []

  $('ul.jobs li').each((_, el) => {
    const titleEl = $(el).find('.title')
    const companyEl = $(el).find('.company')
    const linkEl = $(el).find('a').first()
    const dateEl = $(el).find('time')

    const jobTitle = titleEl.text().trim()
    const company = companyEl.text().trim()
    const href = linkEl.attr('href') ?? ''
    const jobUrl = href.startsWith('http') ? href : `https://weworkremotely.com${href}`
    const postedAt = dateEl.attr('datetime') ?? dateEl.text().trim()

    if (jobTitle && company) {
      results.push({
        company,
        companyUrl: null,
        jobTitle,
        jobUrl,
        location: 'Remote',
        postedAt: postedAt || null,
        snippet: '',
        source: 'WeWorkRemotely',
      })
    }
  })

  return results
}

/**
 * Scrape Remotive for writing jobs.
 */
async function scrapeRemotive(keyword: string): Promise<JobListing[]> {
  const slug = encodeURIComponent(keyword)
  const url = `https://remotive.com/remote-jobs?search=${slug}`
  const html = await fetchHtml(url)
  const $ = cheerio.load(html)
  const results: JobListing[] = []

  $('[data-qa="job-tile"], .job-tile, .tw-cursor-pointer').each((_, el) => {
    const titleEl = $(el).find('h2, h3, [data-qa="job-title"]').first()
    const companyEl = $(el).find('[data-qa="job-company"], .company').first()
    const linkEl = $(el).find('a').first()
    const dateEl = $(el).find('time, [data-qa="job-date"]').first()

    const jobTitle = titleEl.text().trim()
    const company = companyEl.text().trim()
    const href = linkEl.attr('href') ?? ''
    const jobUrl = href.startsWith('http') ? href : `https://remotive.com${href}`
    const postedAt = dateEl.text().trim()

    if (jobTitle && company) {
      results.push({
        company,
        companyUrl: null,
        jobTitle,
        jobUrl,
        location: 'Remote',
        postedAt: postedAt || null,
        snippet: '',
        source: 'Remotive',
      })
    }
  })

  return results
}

/**
 * Scrape Indeed for writing jobs via Google search.
 * Avoids Indeed's bot detection by using Google as proxy.
 */
async function findViaGoogle(keyword: string): Promise<JobListing[]> {
  const query = encodeURIComponent(`"${keyword}" job site:linkedin.com/jobs OR site:indeed.com OR site:glassdoor.com 2024 2025`)
  const url = `https://www.google.com/search?q=${query}&num=15`

  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.5',
    },
  })

  if (!res.ok) return []

  const html = await res.text()
  const $ = cheerio.load(html)
  const results: JobListing[] = []

  $('div.g').each((_, el) => {
    const titleEl = $(el).find('h3').first()
    const linkEl = $(el).find('a').first()
    const snippetEl = $(el).find('.VwiC3b, span').first()

    const title = titleEl.text().trim()
    const href = linkEl.attr('href') ?? ''
    const snippet = snippetEl.text().trim()

    // Extract company name from title pattern "Role at Company | Source"
    const companyMatch = title.match(/(?:at|@)\s+([A-Z][^|–\-]+)/i)
    const company = companyMatch?.[1]?.trim() ?? 'Unknown'

    if (title && href.startsWith('http') && title.toLowerCase().includes('writ')) {
      results.push({
        company,
        companyUrl: null,
        jobTitle: title,
        jobUrl: href,
        location: 'Remote',
        postedAt: null,
        snippet,
        source: 'Google Jobs',
      })
    }
  })

  return results
}

const WRITING_KEYWORDS = [
  'content writer',
  'copywriter',
  'blog writer',
  'content strategist',
  'technical writer',
  'SaaS writer',
]

/**
 * Main discover function.
 * Searches multiple job boards and returns deduplicated listings.
 */
export async function discoverWritingJobs(
  customKeyword?: string
): Promise<JobListing[]> {
  const keywords = customKeyword
    ? [customKeyword]
    : WRITING_KEYWORDS.slice(0, 3) // Limit to 3 to keep it fast

  const allResults: JobListing[] = []

  for (const kw of keywords) {
    const [wwr, remotive, google] = await Promise.allSettled([
      scrapeWeWorkRemotely(kw),
      scrapeRemotive(kw),
      findViaGoogle(kw),
    ])

    if (wwr.status === 'fulfilled') allResults.push(...wwr.value)
    if (remotive.status === 'fulfilled') allResults.push(...remotive.value)
    if (google.status === 'fulfilled') allResults.push(...google.value)
  }

  // Deduplicate by company + title
  const seen = new Set<string>()
  return allResults.filter((j) => {
    const key = `${j.company.toLowerCase()}|${j.jobTitle.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
