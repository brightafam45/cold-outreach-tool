/**
 * POST /api/draft
 * Regenerate or edit a draft message for a specific contact.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { draftMessage } from '@/lib/ai/drafter'
import type { AIProvider } from '@/lib/ai/provider'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    searchId,
    contactId,
    channel,
    instruction,
    aiProvider = 'ollama',
    aiModel = 'llama3.2',
  } = body as {
    searchId: string
    contactId: string
    channel: 'email' | 'linkedin'
    instruction?: string // e.g. "make it shorter", "more casual"
    aiProvider?: AIProvider
    aiModel?: string
  }

  const search = await prisma.search.findUnique({
    where: { id: searchId },
    include: { contacts: true, pitches: true },
  })

  if (!search) return NextResponse.json({ error: 'Search not found' }, { status: 404 })

  const contact = search.contacts.find((c) => c.id === contactId)
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  const draft = await draftMessage({
    contactName: contact.name,
    contactTitle: contact.title ?? '',
    companyName: search.companyName ?? search.input,
    companyDescription: instruction
      ? `Additional instruction: ${instruction}`
      : '',
    industry: search.industry ?? 'SaaS',
    companyType: (search.companyType as 'company' | 'agency') ?? 'company',
    pitches: search.pitches.map((p) => ({
      title: p.title,
      angle: p.angle,
      rationale: p.rationale,
      format: p.format ?? '',
    })),
    channel,
    aiProvider,
    aiModel,
  })

  // Save new version
  const existing = await prisma.draft.findFirst({
    where: { searchId, contactId, channel },
    orderBy: { version: 'desc' },
  })

  await prisma.draft.create({
    data: {
      searchId,
      contactId,
      channel,
      subject: draft.subject,
      body: draft.body,
      version: (existing?.version ?? 0) + 1,
    },
  })

  return NextResponse.json({ draft })
}
