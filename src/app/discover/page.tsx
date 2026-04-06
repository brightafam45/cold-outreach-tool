'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface JobListing {
  company: string
  companyUrl: string | null
  jobTitle: string
  jobUrl: string
  location: string
  postedAt: string | null
  snippet: string
  source: string
}

const QUICK_FILTERS = [
  'content writer',
  'copywriter',
  'SaaS writer',
  'blog writer',
  'technical writer',
  'content strategist',
]

export default function DiscoverPage() {
  const [jobs, setJobs] = useState<JobListing[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [activeFilter, setActiveFilter] = useState<string | null>(null)

  const search = async (kw?: string) => {
    const q = kw ?? keyword
    if (!q.trim()) return
    setLoading(true)
    setSearched(false)
    setActiveFilter(kw ?? null)

    const res = await fetch(`/api/discover?keyword=${encodeURIComponent(q)}`)
    const data = await res.json()
    setJobs(data.jobs ?? [])
    setLoading(false)
    setSearched(true)
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-xl font-black tracking-tight hover:opacity-70 transition-opacity">
            OutreachAI
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/" className="text-muted-foreground hover:text-foreground">Search</Link>
            <Link href="/discover" className="font-medium">Discover</Link>
            <Link href="/history" className="text-muted-foreground hover:text-foreground">History</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Discover Companies Hiring Writers</h1>
          <p className="text-sm text-muted-foreground">
            Find companies actively posting writing jobs — these have budget and are clearly open to content help.
          </p>
        </div>

        {/* Search */}
        <div className="space-y-3">
          <div className="flex gap-2 max-w-xl">
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="e.g. content writer, SaaS copywriter…"
              disabled={loading}
            />
            <Button onClick={() => search()} disabled={loading || !keyword.trim()}>
              {loading ? 'Searching…' : 'Search'}
            </Button>
          </div>

          {/* Quick filters */}
          <div className="flex flex-wrap gap-2">
            {QUICK_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => { setKeyword(f); search(f) }}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  activeFilter === f
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border text-muted-foreground hover:border-foreground/40'
                }`}
                disabled={loading}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground py-6">
            <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            Scraping WeWorkRemotely, Remotive, and Google Jobs…
          </div>
        )}

        {/* Results */}
        {searched && !loading && (
          <div>
            <p className="text-sm text-muted-foreground mb-4">
              {jobs.length} listings found — click a company to research their decision makers
            </p>

            {jobs.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border rounded-xl">
                <p className="text-sm text-muted-foreground">No listings found. Try a different keyword.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {jobs.map((job, i) => (
                  <Card key={i} className="border border-border hover:border-foreground/20 transition-colors">
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="font-semibold text-sm truncate">{job.company}</p>
                            <Badge variant="outline" className="text-xs shrink-0">{job.source}</Badge>
                            {job.location && (
                              <span className="text-xs text-muted-foreground">{job.location}</span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{job.jobTitle}</p>
                          {job.snippet && (
                            <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">{job.snippet}</p>
                          )}
                          {job.postedAt && (
                            <p className="text-xs text-muted-foreground/50 mt-1">{job.postedAt}</p>
                          )}
                        </div>

                        <div className="flex flex-col gap-2 shrink-0">
                          <a href={job.jobUrl} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm" className="text-xs w-full">
                              View job ↗
                            </Button>
                          </a>
                          <Link href={`/?company=${encodeURIComponent(job.company)}`}>
                            <Button size="sm" className="text-xs w-full">
                              Find contacts →
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!searched && !loading && (
          <div className="border border-dashed border-border rounded-xl p-10 text-center space-y-3">
            <p className="text-muted-foreground text-sm">
              Pick a quick filter above or type your own keyword to find companies hiring writers right now.
            </p>
            <p className="text-xs text-muted-foreground">
              Sources: WeWorkRemotely · Remotive · Google Jobs
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
