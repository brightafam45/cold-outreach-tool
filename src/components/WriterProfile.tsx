'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface WriterProfileData {
  niches: string
  contentTypes: string
  writingStyle: string
  bio: string
}

const STORAGE_KEY = 'writer_profile'

const NICHE_EXAMPLES = ['SaaS', 'fintech', 'cybersecurity', 'healthcare tech', 'e-commerce', 'dev tools', 'HR tech', 'marketing tech']
const CONTENT_EXAMPLES = ['blog posts', 'case studies', 'newsletters', 'whitepapers', 'LinkedIn posts', 'landing pages']
const STYLE_EXAMPLES = ['technical and data-driven', 'conversational and educational', 'strategic and thought leadership', 'punchy and direct']

interface Props {
  onComplete: (profile: WriterProfileData) => void
  onSkip: () => void
}

export default function WriterProfile({ onComplete, onSkip }: Props) {
  const [step, setStep] = useState(0)
  const [profile, setProfile] = useState<WriterProfileData>({
    niches: '',
    contentTypes: '',
    writingStyle: '',
    bio: '',
  })

  const questions = [
    {
      key: 'niches' as keyof WriterProfileData,
      question: "What industries or niches do you write for?",
      hint: "The more specific, the better your pitches will be.",
      placeholder: "e.g. B2B SaaS, fintech, developer tools",
      examples: NICHE_EXAMPLES,
    },
    {
      key: 'contentTypes' as keyof WriterProfileData,
      question: "What types of content do you write?",
      hint: "This helps match you to the right companies.",
      placeholder: "e.g. long-form blog posts, case studies, email newsletters",
      examples: CONTENT_EXAMPLES,
    },
    {
      key: 'writingStyle' as keyof WriterProfileData,
      question: "How would you describe your writing style?",
      hint: "Used to write drafts that actually sound like you.",
      placeholder: "e.g. technical but accessible, conversational, data-driven",
      examples: STYLE_EXAMPLES,
    },
    {
      key: 'bio' as keyof WriterProfileData,
      question: "One sentence about your background as a writer",
      hint: "Optional but helps the AI write better outreach for you.",
      placeholder: "e.g. Ex-marketer turned writer, 4 years writing for Series A–C SaaS companies",
      examples: [],
    },
  ]

  const current = questions[step]
  const isLast = step === questions.length - 1
  const value = profile[current.key]

  function handleNext() {
    if (isLast) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
      onComplete(profile)
    } else {
      setStep(step + 1)
    }
  }

  function addExample(example: string) {
    const existing = profile[current.key]
    const newValue = existing
      ? existing.includes(example) ? existing : `${existing}, ${example}`
      : example
    setProfile({ ...profile, [current.key]: newValue })
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* Progress dots */}
      <div className="flex gap-1.5 mb-8">
        {questions.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i <= step ? 'bg-foreground' : 'bg-muted'
            } ${i === step ? 'w-6' : 'w-3'}`}
          />
        ))}
      </div>

      <div className="space-y-6">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            Step {step + 1} of {questions.length}
          </p>
          <h2 className="text-2xl font-bold">{current.question}</h2>
          <p className="text-sm text-muted-foreground">{current.hint}</p>
        </div>

        <Input
          value={value}
          onChange={(e) => setProfile({ ...profile, [current.key]: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) handleNext()
          }}
          placeholder={current.placeholder}
          className="text-base py-5"
          autoFocus
        />

        {/* Example chips */}
        {current.examples.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {current.examples.map((ex) => (
              <button
                key={ex}
                onClick={() => addExample(ex)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  value.includes(ex)
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
                }`}
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            onClick={handleNext}
            disabled={!value.trim() && current.key !== 'bio'}
            className="flex-1"
          >
            {isLast ? 'Start searching' : 'Next →'}
          </Button>
          {(current.key === 'bio' || step > 0) && (
            <Button variant="ghost" onClick={() => {
              if (isLast) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
                onComplete(profile)
              } else {
                setStep(step + 1)
              }
            }}>
              Skip
            </Button>
          )}
        </div>

        {step === 0 && (
          <button
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground block"
          >
            Skip setup and search without personalisation
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Load saved writer profile from localStorage.
 */
export function loadWriterProfile(): WriterProfileData | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

/**
 * Clear saved writer profile.
 */
export function clearWriterProfile() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
}
