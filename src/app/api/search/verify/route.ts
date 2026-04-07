import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { guessEmails, parseName } from '@/lib/contacts/emailGuesser'
import { findBestEmail } from '@/lib/contacts/emailVerifier'
import { extractDomain } from '@/lib/scrapers/website'

export async function POST(req: NextRequest) {
  try {
    const { searchId } = await req.json()
    const search = await prisma.search.findUniqueOrThrow({
      where: { id: searchId },
      include: { contacts: true },
    })

    const domain = extractDomain(search.input)
    const topContacts = search.contacts.slice(0, 5)

    const verifyPromises = topContacts.map(async (contact) => {
      const { firstName, lastName } = parseName(contact.name)
      if (!firstName || !lastName) return

      const guesses = guessEmails(firstName, lastName, domain).slice(0, 5).map(g => g.email)
      const verified = await findBestEmail(guesses).catch(() => null)

      if (verified) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { email: verified.email, emailStatus: verified.status },
        })
      }
    })

    await Promise.all(verifyPromises)

    const updated = await prisma.contact.findMany({ where: { searchId } })
    return NextResponse.json({ contacts: updated })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
