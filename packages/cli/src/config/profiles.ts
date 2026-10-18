/**
 * Production URL is not defined yet. `.invalid` is reserved (RFC 2606) and
 * never resolves, so nothing can leak to it; the CLI refuses it with a hint.
 * TODO(cli-dist): replace with the production origin once it exists.
 */
export const PRODUCTION_URL = 'https://app.steel.invalid'
export const HOMOLOGACAO_URL = 'https://homologacao.stratustelecom.com.br'

export const BUILTIN_PROFILES: Readonly<Record<string, { url: string }>> = {
  producao: { url: PRODUCTION_URL },
  homologacao: { url: HOMOLOGACAO_URL },
}

/** Homologação until production has a real URL. */
export const DEFAULT_PROFILE = 'homologacao'

const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/

export function isValidProfileName(name: string): boolean {
  return PROFILE_NAME.test(name)
}

export function isPlaceholderUrl(url: string): boolean {
  return new URL(url).hostname.endsWith('.invalid')
}

/** Accepts `https://` anywhere and `http://` only on loopback (local dev). */
export function normalizeBaseUrl(input: string): string | undefined {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return undefined
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    return undefined
  }
  if (url.username || url.password || url.search || url.hash) return undefined
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}
