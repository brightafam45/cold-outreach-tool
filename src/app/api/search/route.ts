/**
 * POST /api/search
 * Main search endpoint.
 * Takes a company name or URL and runs the full pipeline:
 * 1. Resolve company info
 * 2. Find decision-maker contacts
 * 3. Verify emails
 * 4. Analyze content + competitors
 * 5. Generate pitches
 * 6. Draft outreach messages
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { findContacts } from '@/lib/contacts/contactFinder'
import { extractDomain, scrapeHomepage, scrapeBlog } from '@/lib/scrapers/website'
import { findBlogUrl } from '@/lib/scrapers/google'
import {
  analyzeCompanyContent,
  generatePitches,
  getCompetitorContext,
} from '@/lib/analysis/contentAnalyzer'
import { draftMessage } from '@/lib/ai/drafter'
import type { AIProvider } from '@/lib/ai/provider'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { input, aiProvider = 'ollama', aiModel = 'llama3.2' } = body as {
      input: string
      aiProvider?: AIProvider
      aiModel?: string
    }

    if (!input?.trim()) {
      return NextResponse.json({ error: 'A website URL is required' }, { status: 400 })
    }

    // ── 1. Create search record ───────────────────────────────────────────
    const search = await prisma.search.create({
      data: {
        input: input.trim(),
        status: 'running',
      },
    })

    // ── 2. Resolve company domain & homepage ─────────────────────────────
    const domain = extractDomain(input)
    const companyName = input.includes('.') ? domain.split('.')[0] : input

    let companyDescription = ''
    let keywords: string[] = []
    let linkedinCompanyUrl: string | undefined

    try {
      const homepage = await scrapeHomepage(domain)
      companyDescription = homepage.description
      keywords = homepage.keywords
      linkedinCompanyUrl = homepage.linkedinUrl
    } catch {
      companyDescription = `${companyName} — a company in the ${domain} space`
    }

    // Detect agency vs company based on keywords + name
    const agencyKeywords = ['agency', 'marketing agency', 'content agency', 'creative agency', 'studio', 'consulting']
    const isAgency = agencyKeywords.some(
      (k) =>
        companyName.toLowerCase().includes(k) ||
        companyDescription.toLowerCase().includes(k)
    )
    const companyType = isAgency ? 'agency' : 'company'

    // Detect industry
    const industry = keywords.slice(0, 3).join(', ') || 'SaaS / Technology'

    await prisma.search.update({
      where: { id: search.id },
      data: {
        companyName,
        companyUrl: `https://${domain}`,
        companyType,
        industry,
      },
    })

    // ── 3. Find contacts ──────────────────────────────────────────────────
    const contacts = await findContacts(input, aiProvider, aiModel)

    // Save contacts to DB
    for (const c of contacts) {
      await prisma.contact.create({
        data: {
          searchId: search.id,
          name: c.name,
          title: c.title,
          email: c.email,
          emailStatus: c.emailStatus,
          linkedinUrl: c.linkedinUrl,
          confidence: c.confidence,
          rank: c.rank,
        },
      })
    }

    // ── 4. Blog analysis + pitches ────────────────────────────────────────
    let pitches: Awaited<ReturnType<typeof generatePitches>> = []

    const blogUrl = await findBlogUrl(domain).catch(() => null)
    const contentAnalysis = await analyzeCompanyContent(
      blogUrl,
      companyName,
      industry,
      companyDescription
    )

    const competitorContext = await getCompetitorContext(companyName, industry).catch(() => '')

    pitches = await generatePitches(
      companyName,
      companyDescription + (competitorContext ? `\n\nCompetitor context: ${competitorContext}` : ''),
      industry,
      contentAnalysis?.topics ?? [],
      companyType,
      aiProvider,
      aiModel
    )

    // Save pitches
    for (const p of pitches) {
      await prisma.pitch.create({
        data: {
          searchId: search.id,
          title: p.title,
          angle: p.angle,
          rationale: p.rationale,
          format: p.format,
        },
      })
    }

    // ── 5. Draft messages for top 2 contacts ─────────────────────────────
    const drafts: Array<{ contactId?: string; email?: MessageDraftResult; linkedin?: MessageDraftResult }> = []

    const topContacts = contacts.slice(0, 2)
    for (const contact of topContacts) {
      const dbContact = await prisma.contact.findFirst({
        where: { searchId: search.id, name: contact.name },
      })

      const emailDraft = await draftMessage({
        contactName: contact.name,
        contactTitle: contact.title,
        companyName,
        companyDescription,
        industry,
        companyType,
        pitches,
        channel: 'email',
        aiProvider,
        aiModel,
      })

      const linkedinDraft = await draftMessage({
        contactName: contact.name,
        contactTitle: contact.title,
        companyName,
        companyDescription,
        industry,
        companyType,
        pitches,
        channel: 'linkedin',
        aiProvider,
        aiModel,
      })

      if (dbContact) {
        await prisma.draft.createMany({
          data: [
            {
              searchId: search.id,
              contactId: dbContact.id,
              channel: 'email',
              subject: emailDraft.subject,
              body: emailDraft.body,
            },
            {
              searchId: search.id,
              contactId: dbContact.id,
              channel: 'linkedin',
              body: linkedinDraft.body,
            },
          ],
        })
      }

      drafts.push({
        contactId: dbContact?.id,
        email: emailDraft,
        linkedin: linkedinDraft,
      })
    }

    // ── 6. Mark search complete ──────────────────────────────────────────
    await prisma.search.update({
      where: { id: search.id },
      data: { status: 'done' },
    })

    return NextResponse.json({
      searchId: search.id,
      company: {
        name: companyName,
        url: `https://${domain}`,
        type: companyType,
        industry,
        description: companyDescription,
        linkedinUrl: linkedinCompanyUrl,
      },
      contacts,
      pitches,
      drafts,
      blog: {
        url: blogUrl,
        posts: contentAnalysis?.blogPosts?.slice(0, 5) ?? [],
        postingFrequency: contentAnalysis?.postingFrequency,
      },
    })
  } catch (err) {
    console.error('[/api/search] Error:', err)
    return NextResponse.json(
      { error: 'Search failed', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

type MessageDraftResult = { subject?: string; body: string; channel: string }
