/**
 * Content analyzer.
 * Scrapes and analyzes a company's blog, then uses AI to generate pitch ideas.
 * Writer profile context is used to personalize pitches.
 */

import { scrapeBlog, type BlogPost } from '@/lib/scrapers/website'
import { bingSearch } from '@/lib/scrapers/bing'
import { prompt, type AIProvider } from '@/lib/ai/provider'

export interface ContentAnalysis {
  blogPosts: BlogPost[]
  topics: string[]
  contentGaps: string[]
  postingFrequency: string
  avgContentType: string
  competitorInsights: string
}

export interface PitchIdea {
  title: string
  angle: string
  rationale: string
  format: string
}

export interface WriterProfile {
  niches?: string
  contentTypes?: string
  writingStyle?: string
  bio?: string
}

/**
 * Analyze a company's blog content.
 */
export async function analyzeCompanyContent(
  blogUrl: string | null,
  companyName: string,
  industry: string,
  companyDescription: string
): Promise<ContentAnalysis | null> {
  let blogPosts: BlogPost[] = []

  if (blogUrl) {
    try {
      blogPosts = await scrapeBlog(blogUrl)
    } catch {
      // Blog might be behind JS rendering — continue with what we have
    }
  }

  // Try Bing to find any published content if blog scrape failed
  if (blogPosts.length === 0) {
    try {
      const results = await bingSearch(`site:${companyName.toLowerCase().replace(/\s+/g, '')}.com blog`, 5)
      blogPosts = results.map((r) => ({
        title: r.title,
        url: r.url,
        excerpt: r.snippet,
      }))
    } catch { /* ignore */ }
  }

  // Extract topics
  const topics = blogPosts.map((p) => p.title).slice(0, 10)

  // Estimate posting frequency
  const postingFrequency =
    blogPosts.length === 0
      ? 'Unknown'
      : blogPosts.length >= 12
      ? 'Active (12+ posts visible)'
      : blogPosts.length >= 5
      ? 'Moderate (5–11 posts visible)'
      : 'Low (fewer than 5 posts visible)'

  return {
    blogPosts,
    topics,
    contentGaps: [],
    postingFrequency,
    avgContentType: 'Blog posts',
    competitorInsights: '',
  }
}

/**
 * Generate pitch ideas using AI.
 * Personalised using writer profile so pitches match the writer's actual niche.
 */
export async function generatePitches(
  companyName: string,
  companyDescription: string,
  industry: string,
  existingTopics: string[],
  companyType: 'company' | 'agency',
  aiProvider: AIProvider = 'groq',
  aiModel = 'llama-3.3-70b-versatile',
  writerProfile?: WriterProfile
): Promise<PitchIdea[]> {
  const isAgency = companyType === 'agency'

  // Build writer context section
  const writerContext = buildWriterContext(writerProfile)

  const systemPrompt = `You are a working freelance content writer crafting pitch ideas for cold outreach. You have a distinct niche and point of view.

${writerContext}

CRITICAL RULES for pitch ideas:
- Be SPECIFIC to this actual company — reference their real industry, product, or content
- NO generic SaaS filler like "best practices", "complete guide", "how to scale"
- NO placeholder text like "[Specific Industry]" or "[Company Name]"
- Each pitch must name a real angle this company would care about
- Think like a journalist finding a story angle, not like a marketer writing a brief
- If you don't know their exact content, look at what their INDUSTRY needs right now`

  const existingTopicsText = existingTopics.length > 0
    ? `Their existing blog posts include: ${existingTopics.slice(0, 8).join(', ')}`
    : `They may not have a blog yet, or their content is not publicly visible.`

  const userPrompt = isAgency
    ? `I want to approach ${companyName}, a ${industry} marketing/content agency, about freelance writing work.

Company: ${companyDescription}

Since they're an agency, I need compelling reasons to work with me — not content pitches for their clients. Generate 3-5 specific angles:
- What overflow work or niche I can handle that frees up their team
- Why a specialist writer (with my background) is better than a generalist for certain pieces
- Concrete examples of the type of work I'd deliver

Return ONLY a JSON array, no other text:
[
  {
    "title": "Short pitch angle headline (max 10 words)",
    "angle": "The specific hook or value proposition (1-2 sentences)",
    "rationale": "Why this matters to an agency (1 sentence)",
    "format": "How to position this in the outreach message"
  }
]`
    : `I want to pitch writing services to ${companyName}.

Company: ${companyDescription}
Industry: ${industry}
${existingTopicsText}

Generate 3-5 SPECIFIC pitch ideas I can use in cold outreach. Each idea should:
- Be relevant to what ${companyName} actually sells or does
- Address a real gap, trend, or opportunity in the ${industry} space RIGHT NOW
- Be something a content editor would immediately want to commission
- Feel like it came from someone who actually knows this industry

Do NOT write:
- "The Ultimate Guide to [vague topic]"
- "How [Company] Can Scale Their Content"
- Any title with a placeholder in brackets

Return ONLY a JSON array, no other text:
[
  {
    "title": "Specific, concrete article or content idea (not a template)",
    "angle": "The unique hook that makes this interesting right now",
    "rationale": "Why this drives business results for ${companyName} specifically",
    "format": "Content type: long-form blog, case study, newsletter, data-driven piece, etc."
  }
]`

  try {
    const response = await prompt(systemPrompt, userPrompt, aiProvider, aiModel)

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0]) as PitchIdea[]

    // Filter out any pitches with obvious placeholder text
    const filtered = parsed.filter((p) =>
      !p.title.includes('[') &&
      !p.title.toLowerCase().includes('specific industry') &&
      !p.title.toLowerCase().includes('company name') &&
      p.title.length > 5
    )

    return filtered.slice(0, 5)
  } catch {
    return []
  }
}

/**
 * Build writer context string from profile.
 */
function buildWriterContext(profile?: WriterProfile): string {
  if (!profile || (!profile.niches && !profile.contentTypes && !profile.writingStyle && !profile.bio)) {
    return 'You are a B2B/SaaS content writer with broad expertise.'
  }

  const parts: string[] = []
  if (profile.niches) parts.push(`Your writing niche: ${profile.niches}`)
  if (profile.contentTypes) parts.push(`Content types you write: ${profile.contentTypes}`)
  if (profile.writingStyle) parts.push(`Your writing style: ${profile.writingStyle}`)
  if (profile.bio) parts.push(`About you: ${profile.bio}`)

  return parts.join('\n')
}
