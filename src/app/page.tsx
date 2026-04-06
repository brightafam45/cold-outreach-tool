'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import SearchResults from '@/components/SearchResults'

type SearchState = 'idle' | 'loading' | 'done' | 'error'

const STEPS = [
  'Resolving company info…',
  'Searching for decision makers…',
  'Finding LinkedIn profiles…',
  'Verifying email addresses…',
  'Analyzing blog and content…',
  'Researching competitors…',
  'Generating pitch ideas…',
  'Drafting outreach messages…',
  'Wrapping up…',
]

function HomeInner() {
  const searchParams = useSearchParams()
  const [input, setInput] = useState(searchParams.get('company') ?? '')
  const [state, setState] = useState<SearchState>('idle')
  const [stepIndex, setStepIndex] = useState(0)
  const [results, setResults] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Auto-run if company param is passed from Discover page
  useEffect(() => {
    const company = searchParams.get('company')
    if (company) runSearch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const runSearch = async () => {
    if (!input.trim()) return
    setState('loading')
    setError(null)
    setResults(null)
    setStepIndex(0)

    // Advance step labels during loading for UX feedback
    const interval = setInterval(() => {
      setStepIndex((prev) => Math.min(prev + 1, STEPS.length - 1))
    }, 4000)

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: input.trim(),
          aiProvider: 'claude',
          aiModel: 'llama3.2',
        }),
      })

      clearInterval(interval)

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Search failed')
      }

      const data = await res.json()
      setResults(data)
      setState('done')
    } catch (err) {
      clearInterval(interval)
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setState('error')
    }
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

          <div className="flex gap-2 max-w-xl">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="e.g. stripe.com or https://notion.so"
              className="flex-1"
              disabled={state === 'loading'}
              type="url"
            />
            <Button
              onClick={runSearch}
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
              This takes 30–90 seconds — we&apos;re scraping the web so you don&apos;t have to.
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
