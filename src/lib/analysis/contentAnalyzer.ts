/**
 * Content analyzer.
 * Scrapes and analyzes a company's blog, then uses AI to:
 * - Identify content gaps
 * - Find competitor content angles
 * - Generate pitch ideas
 */

import { scrapeBlog, type BlogPost } from '@/lib/scrapers/website'
import { googleSearch, findCompetitors } from '@/lib/scrapers/google'
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

  // Try Google to find any published content
  if (blogPosts.length === 0) {
    const results = await googleSearch(`${companyName} blog site:${companyName.toLowerCase().replace(/\s+/g, '')}.com`, 5)
    blogPosts = results.map((r) => ({
      title: r.title,
      url: r.url,
      excerpt: r.snippet,
    }))
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
 * Wears a content marketing strategist hat.
 */
export async function generatePitches(
  companyName: string,
  companyDescription: string,
  industry: string,
  existingTopics: string[],
  companyType: 'company' | 'agency',
  aiProvider: AIProvider = 'ollama',
  aiModel = 'llama3.2'
): Promise<PitchIdea[]> {
  const isAgency = companyType === 'agency'

  const systemPrompt = `You are an expert content marketing strategist and freelance writer with 10+ years of experience writing for B2B and B2C SaaS companies. You specialize in finding content gaps, creating compelling pitch ideas, and helping writers land clients.

Your job is to analyze a company's content situation and generate specific, actionable pitch ideas that a freelance writer can use to approach the company. Be creative, specific, and think like both a marketer and a writer.`

  const userPrompt = isAgency
    ? `I want to approach ${companyName}, a marketing/content agency, about freelance writing work.

Company description: ${companyDescription}
Industry: ${industry}

Since they're an agency, I DON'T want to pitch article ideas — they already have clients and briefs. Instead, I need 3-5 compelling reasons why they should hire me as a freelance writer. Focus on:
- What value I bring as a specialist SaaS/tech writer
- How I can make their team's work easier
- What makes me different from their staff writers
- Any service gaps an agency might have (overflow work, niche expertise, quick turnaround)

Return a JSON array of pitch ideas in this exact format:
[
  {
    "title": "Short pitch angle headline",
    "angle": "The specific hook or value proposition",
    "rationale": "Why this works for an agency",
    "format": "How to present this in the message"
  }
]`
    : `I want to pitch writing services to ${companyName}.

Company description: ${companyDescription}
Industry: ${industry}
Their existing blog topics: ${existingTopics.length > 0 ? existingTopics.join(', ') : 'Unknown — they may not have a blog yet'}

Generate 3-5 specific, creative pitch ideas I can use in my cold outreach. Think like a content strategist:
- What topics are they likely missing?
- What's trending in their industry that they haven't covered?
- What content would drive leads or SEO for their business?
- What's an out-of-the-box angle that would make a decision maker say "I never thought of that"?

Return a JSON array in this exact format:
[
  {
    "title": "Specific article or content idea title",
    "angle": "The unique hook or angle that makes this interesting",
    "rationale": "Why this topic would benefit their business (SEO, leads, brand, etc.)",
    "format": "Content type: blog post, case study, newsletter, comparison article, etc."
  }
]`

  try {
    const response = await prompt(systemPrompt, userPrompt, aiProvider, aiModel)

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0]) as PitchIdea[]
    return parsed.slice(0, 5)
  } catch {
    return []
  }
}

/**
 * Generate competitor analysis context.
 */
export async function getCompetitorContext(
  companyName: string,
  industry: string
): Promise<string> {
  const competitors = await findCompetitors(companyName, industry)

  if (competitors.length === 0) return ''

  // Search for what competitors are writing about
  const competitorTopics: string[] = []
  for (const comp of competitors.slice(0, 2)) {
    const results = await googleSearch(`${comp} blog content marketing`, 3)
    results.forEach((r) => competitorTopics.push(r.title))
  }

  return `Competitors: ${competitors.join(', ')}. Their content: ${competitorTopics.slice(0, 5).join('; ')}`
}
