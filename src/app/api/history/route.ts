/**
 * GET /api/history
 * Returns past searches with their contacts and status.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

export async function GET() {
  const searches = await prisma.search.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      contacts: { orderBy: { rank: 'asc' }, take: 3 },
      pitches: { take: 2 },
      _count: { select: { contacts: true, pitches: true, drafts: true } },
    },
  })

  return NextResponse.json({ searches })
}
