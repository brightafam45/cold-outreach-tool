/**
 * GET /api/discover?keyword=content+writer
 * Finds companies actively hiring writers across job boards.
 */

import { NextRequest, NextResponse } from 'next/server'
import { discoverWritingJobs } from '@/lib/scrapers/jobBoards'

export async function GET(req: NextRequest) {
  const keyword = req.nextUrl.searchParams.get('keyword') ?? undefined

  try {
    const jobs = await discoverWritingJobs(keyword)
    return NextResponse.json({ jobs, total: jobs.length })
  } catch (err) {
    return NextResponse.json(
      { error: 'Discover failed', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
