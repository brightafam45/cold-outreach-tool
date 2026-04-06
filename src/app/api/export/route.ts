/**
 * GET /api/export?searchId=xxx
 * Exports search results as a CSV file.
 * Includes contacts, emails, LinkedIn URLs, pitches, and draft messages.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

function toCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const escape = (val: string) => `"${(val ?? '').replace(/"/g, '""')}"`

  return [
    headers.map(escape).join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h] ?? '')).join(',')),
  ].join('\n')
}

export async function GET(req: NextRequest) {
  const searchId = req.nextUrl.searchParams.get('searchId')

  if (!searchId) {
    return NextResponse.json({ error: 'searchId is required' }, { status: 400 })
  }

  const search = await prisma.search.findUnique({
    where: { id: searchId },
    include: {
      contacts: true,
      pitches: true,
      drafts: true,
    },
  })

  if (!search) {
    return NextResponse.json({ error: 'Search not found' }, { status: 404 })
  }

  const rows: Record<string, string>[] = []

  for (const contact of search.contacts) {
    const emailDraft = search.drafts.find(
      (d) => d.contactId === contact.id && d.channel === 'email'
    )
    const linkedinDraft = search.drafts.find(
      (d) => d.contactId === contact.id && d.channel === 'linkedin'
    )

    rows.push({
      'Company Name': search.companyName ?? search.input,
      'Company URL': search.companyUrl ?? '',
      'Company Type': search.companyType ?? '',
      Industry: search.industry ?? '',
      'Contact Name': contact.name,
      'Contact Title': contact.title ?? '',
      Email: contact.email ?? '',
      'Email Status': contact.emailStatus ?? '',
      'LinkedIn URL': contact.linkedinUrl ?? '',
      'Confidence Score': String(contact.confidence),
      'Rank': String(contact.rank),
      'Email Subject': emailDraft?.subject ?? '',
      'Email Draft': emailDraft?.body ?? '',
      'LinkedIn Draft': linkedinDraft?.body ?? '',
      'Pitch 1': search.pitches[0] ? `${search.pitches[0].title} — ${search.pitches[0].angle}` : '',
      'Pitch 2': search.pitches[1] ? `${search.pitches[1].title} — ${search.pitches[1].angle}` : '',
      'Pitch 3': search.pitches[2] ? `${search.pitches[2].title} — ${search.pitches[2].angle}` : '',
      'Search Date': search.createdAt.toISOString(),
    })
  }

  const csv = toCsv(rows)
  const filename = `outreach-${search.companyName ?? 'export'}-${Date.now()}.csv`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
