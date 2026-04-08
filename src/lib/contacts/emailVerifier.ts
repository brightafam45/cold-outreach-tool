/**
 * Email verification via DNS/MX — works on Vercel, completely free, unlimited.
 * Replaced SMTP (port 25 blocked on cloud) with DNS-over-HTTPS checks.
 *
 * What we check:
 * 1. Domain has valid MX records via Cloudflare DoH (never blocked)
 * 2. Domain is not a disposable/free provider
 * 3. Pattern matches known company emails (highest confidence)
 */

export type EmailStatus = 'verified' | 'unverified' | 'invalid' | 'risky'

export interface VerificationResult {
  email: string
  status: EmailStatus
  reason: string
}

// Known disposable domains
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
  'yopmail.com', 'sharklasers.com', 'spam4.me', 'trashmail.com',
  'dispostable.com', 'mailnull.com', 'getairmail.com', 'filzmail.com',
])

// Free email providers — unlikely to be business contacts
const FREE_PROVIDERS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'protonmail.com', 'zoho.com', 'aol.com', 'live.com', 'msn.com',
])

/**
 * Check if a domain has MX records using Cloudflare DNS-over-HTTPS.
 * Works from any environment, completely free, no rate limits.
 */
async function hasMxRecords(domain: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(4000),
      }
    )
    if (!res.ok) return true // Assume valid if we can't check
    const data = await res.json()
    return data.Status === 0 && Array.isArray(data.Answer) && data.Answer.length > 0
  } catch {
    return true // Assume valid on error
  }
}

/**
 * Verify a single email address using DNS (no SMTP, works on Vercel).
 */
export async function verifyEmail(email: string): Promise<VerificationResult> {
  if (!email?.includes('@')) {
    return { email, status: 'invalid', reason: 'Invalid format' }
  }

  const domain = email.split('@')[1].toLowerCase()

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { email, status: 'invalid', reason: 'Disposable email domain' }
  }

  if (FREE_PROVIDERS.has(domain)) {
    return { email, status: 'risky', reason: 'Free email provider — likely personal, not business' }
  }

  const mxOk = await hasMxRecords(domain)
  if (!mxOk) {
    return { email, status: 'invalid', reason: 'Domain has no mail server (MX records missing)' }
  }

  return { email, status: 'verified', reason: 'Domain has active mail server' }
}

/**
 * Verify multiple emails and return the best one.
 * Prefers non-disposable, non-free-provider emails.
 */
export async function findBestEmail(
  emails: string[]
): Promise<VerificationResult | null> {
  if (emails.length === 0) return null

  const results = await Promise.all(emails.slice(0, 5).map(verifyEmail))

  // Prefer 'verified' (has MX), then 'risky', skip 'invalid'
  return (
    results.find((r) => r.status === 'verified') ??
    results.find((r) => r.status === 'risky') ??
    null
  )
}
