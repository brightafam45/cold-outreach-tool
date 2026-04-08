import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { generatePitches } from '@/lib/analysis/contentAnalyzer'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { searchId, writerProfile } = body
    const search = await prisma.search.findUniqueOrThrow({ where: { id: searchId } })

    const topics = search.blogTopics ? JSON.parse(search.blogTopics) : []

    const pitches = await generatePitches(
      search.companyName ?? '',
      search.description ?? '',
      search.industry ?? '',
      topics,
      (search.companyType ?? 'company') as 'company' | 'agency',
      'groq',
      'llama-3.3-70b-versatile',
      writerProfile
    )

    for (const p of pitches) {
      await prisma.pitch.create({
        data: { searchId, title: p.title, angle: p.angle, rationale: p.rationale, format: p.format },
      })
    }

    return NextResponse.json({ pitches })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
