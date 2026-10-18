import { type DeviceToken, waitForDeviceToken } from '@steel-so/sdk'
import { Text } from 'ink'
import type { Context } from '../context.js'
import { CliError, EXIT, fromSteelError } from '../errors.js'
import { formatDate } from '../lib/format.js'
import { Code, Hint, Success, Warning } from '../ui/components.js'
import { DeviceLogin, type DeviceLoginState } from '../ui/device-login.js'
import { moduleLabel } from '../ui/theme.js'

export interface LoginOptions {
  browser: boolean
}

interface LoginView {
  update(state: DeviceLoginState): void
  close(): void
}

/** Ink live view on a terminal; a plain stderr line everywhere else. */
async function createView(ctx: Context): Promise<LoginView> {
  if (ctx.live) {
    const { render } = await import('ink')
    let instance: ReturnType<typeof render> | undefined
    return {
      update(state) {
        if (instance) instance.rerender(<DeviceLogin {...state} />)
        else {
          instance = render(<DeviceLogin {...state} />, {
            stdout: ctx.io.stdout as NodeJS.WriteStream,
            exitOnCtrlC: false,
            patchConsole: false,
          })
        }
      },
      close() {
        instance?.clear()
        instance?.unmount()
      },
    }
  }
  let printed = false
  return {
    update({ device }) {
      if (printed) return
      printed = true
      ctx.io.stderr.write(
        `Para entrar, abra ${device.verificationUriComplete} e confirme o código ${device.userCode}\n`,
      )
    },
    close() {},
  }
}

export async function login(ctx: Context, options: LoginOptions) {
  const target = await ctx.target()
  const client = ctx.client(target)

  if (ctx.env.STEEL_TOKEN && !ctx.json) {
    ctx.render(
      <Warning>
        STEEL_TOKEN está definida e continua valendo no lugar deste login.
      </Warning>,
      ctx.io.stderr,
    )
  }

  const started = await client.auth.startDevice({
    clientName: 'Steel CLI',
    deviceName: ctx.deps.hostname(),
  })
  if (!started.ok) throw fromSteelError(started.error, target.url)
  const device = started.data

  const view = await createView(ctx)
  const state: DeviceLoginState = {
    device,
    profileName: target.profileName,
    url: target.url,
  }
  view.update(state)
  if (options.browser && !ctx.json) {
    const opened = await ctx.deps.openBrowser(device.verificationUriComplete)
    view.update({ ...state, browserOpened: opened })
  }

  const outcome = await waitForDeviceToken(client, device, {
    signal: ctx.deps.interrupt,
    sleep: ctx.deps.sleep,
  }).finally(() => view.close())

  switch (outcome.status) {
    case 'approved':
      return finish(ctx, target.profileName, target.url, outcome.token)
    case 'expired':
      throw new CliError('O código expirou antes da confirmação.', {
        hint: 'Rode `steel login` de novo.',
        code: 'EXPIRED_TOKEN',
        exitCode: EXIT.AUTH,
      })
    case 'denied':
      throw new CliError('O acesso foi negado no navegador.', {
        hint: 'Rode `steel login` de novo se foi engano.',
        code: 'ACCESS_DENIED',
        exitCode: EXIT.AUTH,
      })
    case 'cancelled':
      throw new CliError('Login cancelado.', {
        code: 'CANCELLED',
        exitCode: EXIT.CANCELLED,
      })
    case 'error':
      throw fromSteelError(outcome.error, target.url)
  }
}

async function finish(
  ctx: Context,
  profileName: string,
  url: string,
  token: DeviceToken,
) {
  const storage = await ctx.credentials.save(profileName, token.token)
  await ctx.config.update((config) => {
    const profile = config.profiles[profileName]
    if (!profile) return
    profile.session = {
      workspace: token.workspace,
      tokenId: token.tokenId,
      expiresAt: token.expiresAt,
      scopes: token.scopes,
      modules: token.modules,
      storage,
      savedAt: new Date().toISOString(),
    }
  })

  if (ctx.json) {
    ctx.printJson({
      profile: profileName,
      url,
      workspace: token.workspace,
      tokenId: token.tokenId,
      expiresAt: token.expiresAt,
      scopes: token.scopes,
      modules: token.modules,
      storage,
    })
    return
  }

  const where =
    storage === 'keychain'
      ? 'no chaveiro do sistema'
      : `em ${ctx.credentialsPath} (permissão 600)`
  ctx.render(
    <>
      <Success>
        Conectado ao workspace <Text bold>{token.workspace.name}</Text> (
        {token.workspace.slug}) no perfil {profileName}.
      </Success>
      <Text color='gray'>
        {'  '}Escopos {token.scopes.join(', ')} · Módulos{' '}
        {token.modules.map(moduleLabel).join(', ') || '—'} · Válido até{' '}
        {formatDate(token.expiresAt, ctx.deps.timeZone)}
      </Text>
      <Hint>
        Token guardado {where}. Confira com <Code>steel whoami</Code>.
      </Hint>
    </>,
  )
}
