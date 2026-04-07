import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { draftMessage } from '@/lib/ai/drafter'

export async function POST(req: NextRequest) {
  try {
    const { searchId } = await req.json()
    const search = await prisma.search.findUniqueOrThrow({
      where: { id: searchId },
      include: { contacts: true, pitches: true },
    })

    const topContacts = search.contacts.slice(0, 2)
    const drafts: Array<{ contactId?: string; email?: unknown; linkedin?: unknown }> = []

    // Coerce format: string | null -> string for PitchIdea compatibility
    const pitches = search.pitches.map(p => ({ ...p, format: p.format ?? '' }))

    for (const contact of topContacts) {
      const [emailDraft, linkedinDraft] = await Promise.all([
        draftMessage({
          contactName: contact.name,
          contactTitle: contact.title ?? '',
          companyName: search.companyName ?? '',
          companyDescription: search.description ?? '',
          industry: search.industry ?? '',
          companyType: (search.companyType ?? 'company') as 'company' | 'agency',
          pitches,
          channel: 'email',
          aiProvider: 'groq',
          aiModel: 'llama3.2',
        }),
        draftMessage({
          contactName: contact.name,
          contactTitle: contact.title ?? '',
          companyName: search.companyName ?? '',
          companyDescription: search.description ?? '',
          industry: search.industry ?? '',
          companyType: (search.companyType ?? 'company') as 'company' | 'agency',
          pitches,
          channel: 'linkedin',
          aiProvider: 'groq',
          aiModel: 'llama3.2',
        }),
      ])

      await prisma.draft.createMany({
        data: [
          { searchId, contactId: contact.id, channel: 'email', subject: emailDraft.subject, body: emailDraft.body },
          { searchId, contactId: contact.id, channel: 'linkedin', body: linkedinDraft.body },
        ],
      })

      drafts.push({ contactId: contact.id, email: emailDraft, linkedin: linkedinDraft })
    }

    await prisma.search.update({ where: { id: searchId }, data: { status: 'done' } })

    // Return full assembled result
    const finalSearch = await prisma.search.findUniqueOrThrow({
      where: { id: searchId },
      include: { contacts: true, pitches: true, drafts: true },
    })

    return NextResponse.json({
      searchId,
      company: {
        name: finalSearch.companyName,
        url: finalSearch.companyUrl,
        type: finalSearch.companyType,
        industry: finalSearch.industry,
        description: finalSearch.description,
      },
      contacts: finalSearch.contacts,
      pitches: finalSearch.pitches,
      drafts,
      blog: {
        url: finalSearch.blogUrl,
        posts: finalSearch.blogTopics ? JSON.parse(finalSearch.blogTopics) : [],
        postingFrequency: null,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
