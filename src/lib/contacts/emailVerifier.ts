/**
 * Email SMTP verifier.
 * Checks if an email address exists by doing an SMTP handshake.
 * Does NOT send any email — just checks mail server response.
 *
 * Process:
 * 1. Look up MX records for the domain (via DNS-over-HTTPS, no native DNS needed)
 * 2. Connect to mail server
 * 3. Send EHLO + MAIL FROM + RCPT TO commands
 * 4. Check if server accepts or rejects the address
 * 5. Quit immediately (no email sent)
 */

import * as net from 'net'
import * as dns from 'dns/promises'

export type EmailStatus = 'verified' | 'unverified' | 'invalid' | 'risky'

export interface VerificationResult {
  email: string
  status: EmailStatus
  reason: string
}

const TIMEOUT_MS = 8000
const FROM_EMAIL = 'verify@outreach-check.com'

/**
 * Get MX records for a domain, sorted by priority.
 */
async function getMxHost(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveMx(domain)
    if (!records || records.length === 0) return null
    records.sort((a, b) => a.priority - b.priority)
    return records[0].exchange
  } catch {
    return null
  }
}

/**
 * Do SMTP handshake to verify an email without sending.
 */
async function smtpVerify(email: string): Promise<VerificationResult> {
  const [localPart, domain] = email.split('@')

  if (!localPart || !domain) {
    return { email, status: 'invalid', reason: 'Malformed email address' }
  }

  // Domains that block SMTP verification (catch-all or known blockers)
  const catchAllDomains = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'googlemail.com', 'protonmail.com', 'icloud.com',
  ]

  if (catchAllDomains.includes(domain.toLowerCase())) {
    return { email, status: 'risky', reason: 'Free email provider — cannot verify via SMTP' }
  }

  const mxHost = await getMxHost(domain)
  if (!mxHost) {
    return { email, status: 'invalid', reason: 'No MX records found for domain' }
  }

  return new Promise((resolve) => {
    const socket = new net.Socket()
    let stage = 0
    let responseBuffer = ''
    let resolved = false

    const done = (result: VerificationResult) => {
      if (!resolved) {
        resolved = true
        socket.destroy()
        resolve(result)
      }
    }

    socket.setTimeout(TIMEOUT_MS)

    socket.on('timeout', () => {
      done({ email, status: 'unverified', reason: 'SMTP connection timed out' })
    })

    socket.on('error', () => {
      done({ email, status: 'unverified', reason: 'SMTP connection error' })
    })

    socket.on('data', (data) => {
      responseBuffer += data.toString()
      const lines = responseBuffer.split('\r\n')
      responseBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const code = parseInt(line.slice(0, 3))

        if (stage === 0 && code === 220) {
          // Server ready — send EHLO
          socket.write(`EHLO outreach-verify.com\r\n`)
          stage = 1
        } else if (stage === 1 && (code === 250 || code === 220)) {
          if (!line.includes('-')) {
            // EHLO done — send MAIL FROM
            socket.write(`MAIL FROM:<${FROM_EMAIL}>\r\n`)
            stage = 2
          }
        } else if (stage === 2 && code === 250) {
          // MAIL FROM accepted — send RCPT TO
          socket.write(`RCPT TO:<${email}>\r\n`)
          stage = 3
        } else if (stage === 3) {
          socket.write('QUIT\r\n')
          if (code === 250 || code === 251) {
            done({ email, status: 'verified', reason: 'SMTP accepted the address' })
          } else if (code === 550 || code === 551 || code === 553) {
            done({ email, status: 'invalid', reason: `SMTP rejected: ${line}` })
          } else {
            done({ email, status: 'unverified', reason: `SMTP response: ${line}` })
          }
        }
      }
    })

    socket.connect(25, mxHost)
  })
}

/**
 * Verify a single email address.
 */
export async function verifyEmail(email: string): Promise<VerificationResult> {
  try {
    return await smtpVerify(email)
  } catch (err) {
    return {
      email,
      status: 'unverified',
      reason: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Verify multiple emails and return the best verified one.
 * Stops at the first verified result.
 */
export async function findBestEmail(
  emails: string[]
): Promise<VerificationResult | null> {
  for (const email of emails) {
    const result = await verifyEmail(email)
    if (result.status === 'verified') return result
  }

  // Return first non-invalid if no verified found
  const risky = await Promise.all(emails.slice(0, 3).map(verifyEmail))
  return risky.find((r) => r.status !== 'invalid') ?? null
}
