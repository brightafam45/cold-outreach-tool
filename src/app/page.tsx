'use client'

import { useState } from 'react'
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

export default function Home() {
  const [input, setInput] = useState('')
  const [state, setState] = useState<SearchState>('idle')
  const [stepIndex, setStepIndex] = useState(0)
  const [results, setResults] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)

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
          aiProvider: 'ollama',
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
          <span className="text-xs text-muted-foreground">
            Find decision makers · Generate pitches · Draft messages
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-10">
        {/* Search bar */}
        <div className="space-y-3">
          <h1 className="text-3xl font-black tracking-tight">
            Find your next writing client
          </h1>
          <p className="text-muted-foreground text-sm max-w-xl">
            Enter a company name or website URL. We&apos;ll find the right people to contact,
            analyze their content, generate pitch ideas, and draft your outreach message.
          </p>

          <div className="flex gap-2 max-w-xl">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="e.g. Stripe, Notion, or stripe.com"
              className="flex-1"
              disabled={state === 'loading'}
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
              Try: <button onClick={() => setInput('Notion')} className="underline hover:text-foreground">Notion</button>
              {' · '}
              <button onClick={() => setInput('HubSpot')} className="underline hover:text-foreground">HubSpot</button>
              {' · '}
              <button onClick={() => setInput('linear.app')} className="underline hover:text-foreground">Linear</button>
              {' · '}
              <button onClick={() => setInput('Copy.ai')} className="underline hover:text-foreground">Copy.ai</button>
            </p>
            <p className="text-xs text-muted-foreground">Works with company names or URLs</p>
          </div>
        )}
      </main>
    </div>
  )
}
