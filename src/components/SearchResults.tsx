'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'

interface Contact {
  name: string
  title: string
  email: string | null
  emailStatus: string
  linkedinUrl: string | null
  confidence: number
  rank: number
}

interface Pitch {
  title: string
  angle: string
  rationale: string
  format: string
}

interface Draft {
  email?: { subject?: string; body: string }
  linkedin?: { body: string }
}

interface Company {
  name: string
  url: string
  type: string
  industry: string
  description: string
  linkedinUrl?: string
}

interface Blog {
  url: string | null
  posts: Array<{ title: string; url: string; excerpt?: string }>
  postingFrequency?: string
}

interface SearchResultData {
  searchId: string
  company: Company
  contacts: Contact[]
  pitches: Pitch[]
  drafts: Draft[]
  blog: Blog
}

function EmailStatusBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    verified: 'default',
    risky: 'secondary',
    unverified: 'outline',
    invalid: 'destructive',
  }
  return <Badge variant={variants[status] ?? 'outline'}>{status}</Badge>
}

function ContactCard({ contact, draft }: { contact: Contact; draft?: Draft }) {
  const [activeTab, setActiveTab] = useState<'email' | 'linkedin'>('email')
  const [copied, setCopied] = useState(false)

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="border border-border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-base">{contact.name}</p>
            <p className="text-sm text-muted-foreground">{contact.title}</p>
          </div>
          <Badge variant="outline" className="shrink-0 text-xs">
            #{contact.rank} match · {contact.confidence}% fit
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2 mt-2">
          {contact.email && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{contact.email}</span>
              <EmailStatusBadge status={contact.emailStatus} />
            </div>
          )}
          {contact.linkedinUrl && (
            <a
              href={contact.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              LinkedIn ↗
            </a>
          )}
        </div>
      </CardHeader>

      {draft && (
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'email' | 'linkedin')}>
            <TabsList className="mb-3">
              <TabsTrigger value="email">Email Draft</TabsTrigger>
              <TabsTrigger value="linkedin">LinkedIn DM</TabsTrigger>
            </TabsList>

            <TabsContent value="email">
              {draft.email ? (
                <div className="space-y-2">
                  {draft.email.subject && (
                    <div className="text-xs">
                      <span className="font-medium text-muted-foreground">Subject: </span>
                      {draft.email.subject}
                    </div>
                  )}
                  <pre className="text-sm whitespace-pre-wrap font-sans bg-muted/40 rounded-lg p-3 leading-relaxed">
                    {draft.email.body}
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      copy(
                        draft.email?.subject
                          ? `Subject: ${draft.email.subject}\n\n${draft.email.body}`
                          : draft.email?.body ?? ''
                      )
                    }
                  >
                    {copied ? '✓ Copied' : 'Copy Email'}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No email draft generated.</p>
              )}
            </TabsContent>

            <TabsContent value="linkedin">
              {draft.linkedin ? (
                <div className="space-y-2">
                  <pre className="text-sm whitespace-pre-wrap font-sans bg-muted/40 rounded-lg p-3 leading-relaxed">
                    {draft.linkedin.body}
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copy(draft.linkedin?.body ?? '')}
                  >
                    {copied ? '✓ Copied' : 'Copy DM'}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No LinkedIn draft generated.</p>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  )
}

function PitchCard({ pitch, index }: { pitch: Pitch; index: number }) {
  return (
    <Card className="border border-border">
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl font-black text-muted-foreground/30 leading-none mt-0.5">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className="space-y-1">
            <p className="font-semibold text-sm">{pitch.title}</p>
            <p className="text-sm text-muted-foreground">{pitch.angle}</p>
            <p className="text-xs text-muted-foreground/70">{pitch.rationale}</p>
            {pitch.format && (
              <Badge variant="secondary" className="text-xs mt-1">
                {pitch.format}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function SearchResults({ data }: { data: SearchResultData }) {
  const { company, contacts, pitches, drafts, blog, searchId } = data

  const handleExport = () => {
    window.location.href = `/api/export?searchId=${searchId}`
  }

  return (
    <div className="space-y-8">
      {/* Company header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-2xl font-bold">{company.name}</h2>
            <Badge variant={company.type === 'agency' ? 'secondary' : 'default'}>
              {company.type === 'agency' ? 'Agency' : 'Company'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{company.industry}</p>
          {company.description && (
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl line-clamp-2">
              {company.description}
            </p>
          )}
          <div className="flex gap-3 mt-2">
            {company.url && (
              <a href={company.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                Website ↗
              </a>
            )}
            {company.linkedinUrl && (
              <a href={company.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                LinkedIn ↗
              </a>
            )}
            {blog.url && (
              <a href={blog.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                Blog ↗
              </a>
            )}
          </div>
        </div>
        <Button onClick={handleExport} variant="outline" size="sm">
          ↓ Export CSV
        </Button>
      </div>

      {/* Blog signals */}
      {blog.postingFrequency && (
        <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
          Blog activity: {blog.postingFrequency}
          {blog.posts.length > 0 && (
            <span className="ml-2">
              — Recent: "{blog.posts[0].title}"
            </span>
          )}
        </div>
      )}

      {/* Contacts */}
      <div>
        <h3 className="text-lg font-semibold mb-3">
          Decision Makers ({contacts.length})
        </h3>
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No contacts found. Try searching by URL instead of company name, or check the spelling.
          </p>
        ) : (
          <div className="space-y-4">
            {contacts.map((contact, i) => (
              <ContactCard key={contact.name} contact={contact} draft={drafts[i]} />
            ))}
          </div>
        )}
      </div>

      {/* Pitches */}
      {pitches.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-1">
            {company.type === 'agency' ? 'Why Hire Me' : 'Pitch Ideas'} ({pitches.length})
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            {company.type === 'agency'
              ? 'Value propositions for agency outreach'
              : 'Content angles generated from blog + competitor analysis'}
          </p>
          <div className="space-y-3">
            {pitches.map((pitch, i) => (
              <PitchCard key={i} pitch={pitch} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
