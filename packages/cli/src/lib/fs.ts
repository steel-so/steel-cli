import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Reads a JSON file; `undefined` when it does not exist. */
export async function readJson(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return JSON.parse(text)
}

/** Writes JSON atomically with owner-only permissions (dir 700, file 600). */
export async function writePrivateJson(
  path: string,
  value: unknown,
): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  })
  await chmod(temp, 0o600)
  await rename(temp, path)
}
