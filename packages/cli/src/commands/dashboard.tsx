import type { Context, Terminal } from '../context.js'
import { EXIT, fromSteelError } from '../errors.js'
import { Dashboard } from '../tui/dashboard.js'
import type { DashboardSession } from '../tui/data.js'

/**
 * `steel` alone on a terminal. Auth problems (no token, 401 on `/me`) are
 * printed like any command before the screen switches, so the hint to run
 * `steel login` stays in the scrollback.
 */
export async function dashboard(ctx: Context, terminal: Terminal) {
  const target = await ctx.authTarget()
  const client = ctx.client(target, target.token)
  const me = await client.me()
  if (!me.ok) throw fromSteelError(me.error, target.url)

  const session: DashboardSession = {
    client,
    me: me.data,
    profileName: target.profileName,
    url: target.url,
    timeZone: ctx.deps.timeZone,
    sleep: ctx.deps.sleep,
  }
  const { render } = await import('ink')
  const instance = render(<Dashboard session={session} />, {
    stdin: terminal.stdin,
    stdout: terminal.stdout,
    stderr: terminal.stderr,
    // Only reached with a TTY on both ends, so CI detection must not
    // switch Ink to its print-once mode.
    interactive: true,
    alternateScreen: true,
    exitOnCtrlC: true,
    patchConsole: false,
  })
  await instance.waitUntilExit()
  return EXIT.OK
}
