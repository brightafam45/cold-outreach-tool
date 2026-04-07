import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { findContacts } from '@/lib/contacts/contactFinder'

export async function POST(req: NextRequest) {
  try {
    const { searchId } = await req.json()
    const search = await prisma.search.findUniqueOrThrow({ where: { id: searchId } })

    const contacts = await findContacts(search.input, 'groq', 'llama3.2', { skipEmailVerification: true })

    for (const c of contacts) {
      await prisma.contact.create({
        data: {
          searchId,
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

    return NextResponse.json({ contacts })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
