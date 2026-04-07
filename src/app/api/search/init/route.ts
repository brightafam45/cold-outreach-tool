import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { extractDomain, scrapeHomepage } from '@/lib/scrapers/website'

export async function POST(req: NextRequest) {
  try {
    const { input } = await req.json()
    if (!input?.trim()) return NextResponse.json({ error: 'URL is required' }, { status: 400 })

    const domain = extractDomain(input.trim())
    const companyName = input.includes('.') ? domain.split('.')[0] : input

    let description = ''
    let keywords: string[] = []
    let linkedinUrl: string | undefined

    try {
      const homepage = await scrapeHomepage(domain)
      description = homepage.description
      keywords = homepage.keywords
      linkedinUrl = homepage.linkedinUrl
    } catch {
      description = `${companyName} — a company in the ${domain} space`
    }

    const agencyKeywords = ['agency', 'marketing agency', 'content agency', 'creative agency', 'studio', 'consulting']
    const isAgency = agencyKeywords.some(k =>
      companyName.toLowerCase().includes(k) || description.toLowerCase().includes(k)
    )
    const companyType = isAgency ? 'agency' : 'company'
    const industry = keywords.slice(0, 3).join(', ') || 'SaaS / Technology'

    const search = await prisma.search.create({
      data: {
        input: input.trim(),
        status: 'running',
        companyName,
        companyUrl: `https://${domain}`,
        companyType,
        industry,
        description,
      },
    })

    return NextResponse.json({
      searchId: search.id,
      company: { name: companyName, url: `https://${domain}`, type: companyType, industry, description, linkedinUrl },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
