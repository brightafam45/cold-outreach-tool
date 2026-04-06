/**
 * AI Provider abstraction.
 * Supports Ollama (free, local) and Claude API.
 * Switch via user settings — default is Ollama.
 */

export type AIProvider = 'ollama' | 'claude'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface AIResponse {
  text: string
  provider: AIProvider
}

// ── Ollama ────────────────────────────────────────────────────────────────────

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
      model: 'claude-opus-4-6',
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

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Send a chat prompt to whichever AI provider is configured.
 * @param messages  Array of system/user/assistant messages
 * @param provider  "ollama" | "claude" — defaults to env or "ollama"
 * @param model     Ollama model name (ignored for Claude)
 */
export async function chat(
  messages: ChatMessage[],
  provider: AIProvider = 'ollama',
  model = 'llama3.2'
): Promise<AIResponse> {
  if (provider === 'claude') {
    const text = await chatWithClaude(messages)
    return { text, provider: 'claude' }
  }

  const text = await chatWithOllama(messages, model)
  return { text, provider: 'ollama' }
}

/**
 * Simple single-prompt helper.
 */
export async function prompt(
  systemPrompt: string,
  userPrompt: string,
  provider: AIProvider = 'ollama',
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
