/** Parses `sha256sum` output (`<hex>  <name>`, binary mode `*<name>` too). */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim())
    if (match?.[1] && match[2]) sums.set(match[2], match[1])
  }
  return sums
}
