/**
 * AI Provider abstraction.
 * Supports Groq (free), Claude API, and Ollama (local).
 * Default: Groq (free, fast, no credit card needed)
 */

export type AIProvider = 'groq' | 'claude' | 'ollama'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface AIResponse {
  text: string
  provider: AIProvider
}

// ── Groq (free) ───────────────────────────────────────────────────────────────

async function chatWithGroq(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY is not set — sign up free at groq.com')

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 4096,
      messages,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Groq API error: ${res.status} — ${JSON.stringify(err)}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

// ── Claude API ────────────────────────────────────────────────────────────────

async function chatWithClaude(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY
  if (!apiKey) throw new Error('CLAUDE_API_KEY is not set')

  const system = messages.find((m) => m.role === 'system')?.content
  const userMessages = messages.filter((m) => m.role !== 'system')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      ...(system ? { system } : {}),
      messages: userMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Claude API error: ${res.status} — ${JSON.stringify(err)}`)
  }

  const data = await res.json()
  return data.content?.[0]?.text ?? ''
}

// ── Ollama (local) ────────────────────────────────────────────────────────────

async function chatWithOllama(
  messages: ChatMessage[],
  model = 'llama3.2'
): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  })

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  return data.message?.content ?? ''
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function chat(
  messages: ChatMessage[],
  provider: AIProvider = 'groq',
  model = 'llama3.2'
): Promise<AIResponse> {
  switch (provider) {
    case 'claude': {
      const text = await chatWithClaude(messages)
      return { text, provider: 'claude' }
    }
    case 'ollama': {
      const text = await chatWithOllama(messages, model)
      return { text, provider: 'ollama' }
    }
    default: {
      const text = await chatWithGroq(messages)
      return { text, provider: 'groq' }
    }
  }
}

export async function prompt(
  systemPrompt: string,
  userPrompt: string,
  provider: AIProvider = 'groq',
  model = 'llama3.2'
): Promise<string> {
  const res = await chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    provider,
    model
  )
  return res.text
}
