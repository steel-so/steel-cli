import { createInterface } from 'node:readline/promises'

/** Yes/no question on the terminal; anything but s/sim/y/yes is a no. */
export async function confirmPrompt(
  question: string,
  streams: {
    input: NodeJS.ReadableStream
    output: NodeJS.WritableStream
  } = { input: process.stdin, output: process.stderr },
): Promise<boolean> {
  const rl = createInterface({ ...streams, terminal: true })
  try {
    const answer = await rl.question(`${question} (s/N) `)
    return /^(s|sim|y|yes)$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}
