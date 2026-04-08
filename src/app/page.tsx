'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import SearchResults from '@/components/SearchResults'
import WriterProfile, { loadWriterProfile, type WriterProfileData } from '@/components/WriterProfile'

type SearchState = 'idle' | 'profile' | 'loading' | 'done' | 'error'

const STEPS = [
  'Resolving company info…',
  'Finding decision makers…',
  'Looking up contacts…',
  'Analyzing blog content…',
  'Generating pitch ideas…',
  'Drafting outreach messages…',
]

function HomeInner() {
  const searchParams = useSearchParams()
  const [input, setInput] = useState(searchParams.get('company') ?? '')
  const [state, setState] = useState<SearchState>('idle')
  const [stepIndex, setStepIndex] = useState(0)
  const [results, setResults] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [writerProfile, setWriterProfile] = useState<WriterProfileData | null>(null)

  useEffect(() => {
    const saved = loadWriterProfile()
    if (saved) setWriterProfile(saved)
  }, [])

  // Auto-run if company param is passed from Discover page
  useEffect(() => {
    const company = searchParams.get('company')
    if (company) {
      const saved = loadWriterProfile()
      if (saved) {
        runSearchWithProfile(saved)
      } else {
        setState('profile')
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchClick = () => {
    if (!input.trim()) return
    if (!writerProfile) {
      setState('profile')
    } else {
      runSearchWithProfile(writerProfile)
    }
  }

  const runSearchWithProfile = async (profile: WriterProfileData) => {
    if (!input.trim()) return
    setWriterProfile(profile)
    await runSearch(profile)
  }

  const runSearch = async (profile: WriterProfileData) => {
    setState('loading')
    setError(null)
    setResults(null)
    setStepIndex(0)

    const headers = { 'Content-Type': 'application/json' }

    try {
      // Step 1: Init
      const initRes = await fetch('/api/search/init', {
        method: 'POST', headers,
        body: JSON.stringify({ input: input.trim() }),
      })
      if (!initRes.ok) throw new Error((await initRes.json()).error ?? 'Init failed')
      const { searchId } = await initRes.json()
      setStepIndex(1)

      // Step 2: Find contacts (with writer profile)
      await fetch('/api/search/contacts', {
        method: 'POST', headers,
        body: JSON.stringify({ searchId, writerProfile: profile }),
      })
      setStepIndex(2)

      // Step 3: Verify emails
      await fetch('/api/search/verify', {
        method: 'POST', headers,
        body: JSON.stringify({ searchId }),
      })
      setStepIndex(3)

      // Step 4: Analyze blog
      await fetch('/api/search/analyze', {
        method: 'POST', headers,
        body: JSON.stringify({ searchId }),
      })
      setStepIndex(4)

      // Step 5: Generate pitches (with writer profile)
      await fetch('/api/search/pitches', {
        method: 'POST', headers,
        body: JSON.stringify({ searchId, writerProfile: profile }),
      })
      setStepIndex(5)

      // Step 6: Draft messages — returns full results (with writer profile)
      const draftsRes = await fetch('/api/search/drafts', {
        method: 'POST', headers,
        body: JSON.stringify({ searchId, writerProfile: profile }),
      })
      if (!draftsRes.ok) throw new Error((await draftsRes.json()).error ?? 'Drafting failed')
      const data = await draftsRes.json()
      setResults(data)
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setState('error')
    }
  }

  // Show profile setup
  if (state === 'profile') {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl font-black tracking-tight">OutreachAI</span>
              <Badge variant="secondary" className="text-[10px]">Beta</Badge>
            </div>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="font-medium">Search</Link>
              <Link href="/discover" className="text-muted-foreground hover:text-foreground">Discover</Link>
              <Link href="/history" className="text-muted-foreground hover:text-foreground">History</Link>
            </nav>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-6 py-16">
          <div className="mb-8">
            <p className="text-sm text-muted-foreground mb-1">Before we search for <strong>{input}</strong></p>
            <p className="text-xs text-muted-foreground">Tell us about yourself so the pitches and drafts are actually personalised to you (not generic AI output).</p>
          </div>
          <WriterProfile
            onComplete={(profile) => runSearchWithProfile(profile)}
            onSkip={() => runSearch({ niches: '', contentTypes: '', writingStyle: '', bio: '' })}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl font-black tracking-tight">OutreachAI</span>
            <Badge variant="secondary" className="text-[10px]">Beta</Badge>
          </div>
          <nav className="flex gap-4 text-sm">
            <Link href="/" className="font-medium">Search</Link>
            <Link href="/discover" className="text-muted-foreground hover:text-foreground">Discover</Link>
            <Link href="/history" className="text-muted-foreground hover:text-foreground">History</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-10">
        {/* Search bar */}
        <div className="space-y-3">
          <h1 className="text-3xl font-black tracking-tight">
            Find your next writing client
          </h1>
          <p className="text-muted-foreground text-sm max-w-xl">
            Paste a company website URL. We&apos;ll find the right decision makers, analyze their content,
            generate pitch ideas, and draft your outreach message.
          </p>

          {/* Writer profile badge */}
          {writerProfile?.niches && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
              Writing for: <span className="text-foreground">{writerProfile.niches}</span>
              <button
                onClick={() => setState('profile')}
                className="underline hover:text-foreground ml-1"
              >
                Edit profile
              </button>
            </div>
          )}

          <div className="flex gap-2 max-w-xl">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchClick()}
              placeholder="e.g. stripe.com or https://notion.so"
              className="flex-1"
              disabled={state === 'loading'}
              type="url"
            />
            <Button
              onClick={handleSearchClick}
              disabled={state === 'loading' || !input.trim()}
              className="shrink-0"
            >
              {state === 'loading' ? 'Searching…' : 'Search'}
            </Button>
          </div>
        </div>

        {/* Loading state */}
        {state === 'loading' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="inline-block w-4 h-4 border-2 border-foreground border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">{STEPS[stepIndex]}</span>
            </div>
            <div className="w-full max-w-xl bg-muted rounded-full h-1 overflow-hidden">
              <div
                className="h-full bg-foreground rounded-full transition-all duration-1000"
                style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This takes 30–60 seconds — we&apos;re scraping the web so you don&apos;t have to.
            </p>
          </div>
        )}

        {/* Error state */}
        {state === 'error' && error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <strong>Error:</strong> {error}
            <Button
              variant="outline"
              size="sm"
              className="ml-3"
              onClick={() => setState('idle')}
            >
              Try again
            </Button>
          </div>
        )}

        {/* Results */}
        {state === 'done' && results && (
          <SearchResults data={results as unknown as Parameters<typeof SearchResults>[0]['data']} />
        )}

        {/* Empty state */}
        {state === 'idle' && (
          <div className="border border-dashed border-border rounded-xl p-10 text-center space-y-2">
            <p className="text-muted-foreground text-sm">
              Try: <button onClick={() => setInput('notion.so')} className="underline hover:text-foreground">notion.so</button>
              {' · '}
              <button onClick={() => setInput('hubspot.com')} className="underline hover:text-foreground">hubspot.com</button>
              {' · '}
              <button onClick={() => setInput('linear.app')} className="underline hover:text-foreground">linear.app</button>
              {' · '}
              <button onClick={() => setInput('copy.ai')} className="underline hover:text-foreground">copy.ai</button>
            </p>
            <p className="text-xs text-muted-foreground">Paste any company website URL</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default function Home() {
  return (
    <Suspense>
      <HomeInner />
    </Suspense>
  )
}
