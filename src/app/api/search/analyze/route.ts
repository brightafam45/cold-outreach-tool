import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { extractDomain, scrapeBlog } from '@/lib/scrapers/website'
import { findBlogUrl } from '@/lib/scrapers/google'

export async function POST(req: NextRequest) {
  try {
    const { searchId } = await req.json()
    const search = await prisma.search.findUniqueOrThrow({ where: { id: searchId } })
    const domain = extractDomain(search.input)

    const blogUrl = await findBlogUrl(domain).catch(() => null)
    const blogPosts = blogUrl ? await scrapeBlog(blogUrl).catch(() => []) : []

    const topics = blogPosts.map(p => p.title).slice(0, 10)
    const postingFrequency = blogPosts.length === 0 ? 'Unknown'
      : blogPosts.length >= 12 ? 'Active (12+ posts)'
      : blogPosts.length >= 5 ? 'Moderate (5–11 posts)'
      : 'Low (fewer than 5 posts)'

    await prisma.search.update({
      where: { id: searchId },
      data: {
        blogUrl,
        blogTopics: JSON.stringify(topics),
      },
    })

    return NextResponse.json({
      blog: { url: blogUrl, posts: blogPosts.slice(0, 5), postingFrequency },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
