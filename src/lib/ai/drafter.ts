/**
 * Message drafter.
 * Uses AI to write personalized cold outreach messages.
 * Different approach for companies vs agencies.
 * Supports email and LinkedIn DM formats.
 */

import { prompt, type AIProvider } from '@/lib/ai/provider'
import type { PitchIdea } from '@/lib/analysis/contentAnalyzer'

export interface DraftInput {
  contactName: string
  contactTitle: string
  companyName: string
  companyDescription: string
  industry: string
  companyType: 'company' | 'agency'
  pitches: PitchIdea[]
  channel: 'email' | 'linkedin'
  aiProvider: AIProvider
  aiModel?: string
}

export interface MessageDraft {
  subject?: string  // email only
  body: string
  channel: 'email' | 'linkedin'
}

/**
 * Draft a cold outreach message using AI.
 */
export async function draftMessage(input: DraftInput): Promise<MessageDraft> {
  const {
    contactName,
    contactTitle,
    companyName,
    companyDescription,
    industry,
    companyType,
    pitches,
    channel,
    aiProvider,
    aiModel = 'llama3.2',
  } = input

  const firstName = contactName.split(' ')[0]
  const isEmail = channel === 'email'
  const isAgency = companyType === 'agency'
  const wordLimit = isEmail ? '150-200 words' : '80-120 words (LinkedIn DM limit)'

  const systemPrompt = `You are a freelance B2B/SaaS content writer crafting cold outreach messages. Your writing style is:
- Conversational but professional
- Specific and relevant (not generic)
- Brief — you respect people's time
- Focused on value to them, not your credentials
- Curious, not pushy
- Zero fluff, zero clichés like "I hope this finds you well" or "I'm reaching out because"

You write for B2B and B2C SaaS companies. You specialize in blog posts, thought leadership, and content strategy.`

  const pitchContext = pitches.length > 0
    ? `\n\nPitch ideas to reference (pick 1-2 most relevant):\n${pitches.map((p, i) => `${i + 1}. "${p.title}" — ${p.angle}`).join('\n')}`
    : ''

  const userPrompt = isAgency
    ? `Write a cold ${isEmail ? 'email' : 'LinkedIn DM'} to ${firstName} (${contactTitle}) at ${companyName}, a ${industry} marketing/content agency.

Company description: ${companyDescription}

Goal: Get them to consider me as a freelance content writer for their client work.

This is an agency, so DON'T pitch article ideas. Instead:
- Lead with something specific about their agency (their niche, clients, or work)
- Position myself as a specialist SaaS/B2B writer who can handle overflow work or niche pieces
- Make it easy to say yes — offer a quick call or a sample piece
- Sound like a peer, not an applicant

${isEmail ? 'Include a subject line.' : ''}
Word limit: ${wordLimit}

Format response as JSON:
${isEmail ? '{"subject": "...", "body": "..."}' : '{"body": "..."}'}`
    : `Write a cold ${isEmail ? 'email' : 'LinkedIn DM'} to ${firstName} (${contactTitle}) at ${companyName}, a ${industry} company.

Company description: ${companyDescription}${pitchContext}

Goal: Get them interested in working with me as a freelance content writer. I want to share a pitch idea or two.

Rules:
- Open with something specific about their company or content (not generic praise)
- Reference 1 specific pitch idea naturally in the message
- Don't list multiple pitches — just weave one in as an example of how I think
- End with a clear, low-friction CTA (not "let me know if you're interested")
- No portfolio links, no "I have X years of experience" — show, don't tell

${isEmail ? 'Include a subject line.' : ''}
Word limit: ${wordLimit}

Format response as JSON:
${isEmail ? '{"subject": "...", "body": "..."}' : '{"body": "..."}'}`

  try {
    const response = await prompt(systemPrompt, userPrompt, aiProvider, aiModel)
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { body: response, channel }
    }

    const parsed = JSON.parse(jsonMatch[0])
    return {
      subject: parsed.subject,
      body: parsed.body,
      channel,
    }
  } catch {
    return {
      body: `Hi ${firstName},\n\nI came across ${companyName} and was impressed by [specific thing]. I specialize in B2B SaaS content and think I could help with [specific opportunity].\n\nWould you be open to a quick chat?\n\n[Your name]`,
      channel,
    }
  }
}
