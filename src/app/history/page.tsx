'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface ContactPreview {
  name: string
  title: string | null
  email: string | null
  linkedinUrl: string | null
}

interface PitchPreview {
  title: string
}

interface SearchRecord {
  id: string
  input: string
  companyName: string | null
  companyUrl: string | null
  companyType: string | null
  industry: string | null
  status: string
  createdAt: string
  contacts: ContactPreview[]
  pitches: PitchPreview[]
  _count: { contacts: number; pitches: number; drafts: number }
}

export default function HistoryPage() {
  const [searches, setSearches] = useState<SearchRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/history')
      .then((r) => r.json())
      .then((d) => {
        setSearches(d.searches ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
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
            <Link href="/discover" className="text-muted-foreground hover:text-foreground">Discover</Link>
            <Link href="/history" className="font-medium">History</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Search History</h1>
            <p className="text-sm text-muted-foreground mt-1">All companies you&apos;ve researched</p>
          </div>
          <Link href="/">
            <Button size="sm">+ New Search</Button>
          </Link>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-10">
            <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            Loading history…
          </div>
        )}

        {!loading && searches.length === 0 && (
          <div className="text-center py-20 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground text-sm mb-3">No searches yet.</p>
            <Link href="/"><Button variant="outline" size="sm">Run your first search</Button></Link>
          </div>
        )}

        <div className="space-y-4">
          {searches.map((s) => (
            <Card key={s.id} className="border border-border hover:border-foreground/20 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold">{s.companyName ?? s.input}</p>
                      {s.companyType && (
                        <Badge variant={s.companyType === 'agency' ? 'secondary' : 'default'} className="text-xs">
                          {s.companyType}
                        </Badge>
                      )}
                      <Badge
                        variant={s.status === 'done' ? 'default' : s.status === 'running' ? 'secondary' : 'destructive'}
                        className="text-xs"
                      >
                        {s.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {s.industry && <span>{s.industry} · </span>}
                      {formatDate(s.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <a href={`/api/export?searchId=${s.id}`}>
                      <Button variant="outline" size="sm" className="text-xs">↓ CSV</Button>
                    </a>
                  </div>
                </div>
              </CardHeader>

              <CardContent>
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-3">
                  <span>{s._count.contacts} contact{s._count.contacts !== 1 ? 's' : ''}</span>
                  <span>{s._count.pitches} pitch idea{s._count.pitches !== 1 ? 's' : ''}</span>
                  <span>{s._count.drafts} draft{s._count.drafts !== 1 ? 's' : ''}</span>
                </div>

                {s.contacts.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {s.contacts.map((c) => (
                      <div
                        key={c.name}
                        className="flex items-center gap-1.5 text-xs bg-muted/40 rounded-full px-2.5 py-1"
                      >
                        <span className="font-medium">{c.name}</span>
                        {c.title && <span className="text-muted-foreground">· {c.title}</span>}
                        {c.linkedinUrl && (
                          <a
                            href={c.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline ml-1"
                          >
                            in
                          </a>
                        )}
                      </div>
                    ))}
                    {s._count.contacts > 3 && (
                      <span className="text-xs text-muted-foreground py-1">
                        +{s._count.contacts - 3} more
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  )
}
