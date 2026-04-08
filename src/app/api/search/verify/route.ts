import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

// SMTP verification is blocked on cloud hosting (port 25 blocked).
// Email guessing is already handled in the contacts step.
// This step is kept as a no-op to maintain the pipeline structure.
export async function POST(req: NextRequest) {
  try {
    const { searchId } = await req.json()
    const contacts = await prisma.contact.findMany({ where: { searchId } })
    return NextResponse.json({ contacts })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
