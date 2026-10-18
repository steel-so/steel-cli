import { Text } from 'ink'
import type { Context, TokenSource } from '../context.js'
import { fromSteelError } from '../errors.js'
import { daysUntil, formatDate, relativeDays } from '../lib/format.js'
import { KeyValue, Warning } from '../ui/components.js'
import { moduleLabel, theme } from '../ui/theme.js'

const EXPIRY_WARNING_DAYS = 7

function sourceLabel(ctx: Context, source: TokenSource): string {
  if (source === 'env') return 'variável STEEL_TOKEN'
  if (source === 'keychain') return 'chaveiro do sistema'
  return ctx.credentialsPath
}

export async function whoami(ctx: Context) {
  const target = await ctx.authTarget()
  const result = await ctx.client(target, target.token).me()
  if (!result.ok) throw fromSteelError(result.error, target.url)
  const me = result.data

  if (ctx.json) {
    ctx.printJson({
      ...me,
      profile: target.profileName,
      url: target.url,
      tokenSource: target.tokenSource,
    })
    return
  }

  const days = daysUntil(me.token.expiresAt)
  ctx.render(
    <>
      <KeyValue
        rows={[
          [
            'Usuário',
            <Text key='u'>
              <Text bold>{me.user.name}</Text>{' '}
              <Text color={theme.muted}>{me.user.email}</Text>
            </Text>,
          ],
          [
            'Workspace',
            <Text key='w'>
              {me.workspace.name}{' '}
              <Text color={theme.muted}>({me.workspace.slug})</Text>
            </Text>,
          ],
          ['Perfil', `${target.profileName} · ${target.url}`],
          ['Escopos', me.scopes.join(', ')],
          ['Módulos', me.modules.map(moduleLabel).join(', ') || '—'],
          [
            'Token',
            `${formatDate(me.token.expiresAt, ctx.deps.timeZone)} (${relativeDays(days)})`,
          ],
          ['Origem', sourceLabel(ctx, target.tokenSource)],
        ]}
      />
      {days < EXPIRY_WARNING_DAYS ? (
        <Warning>
          O token expira em breve. Rode `steel login` para gerar outro.
        </Warning>
      ) : null}
    </>,
  )
}
