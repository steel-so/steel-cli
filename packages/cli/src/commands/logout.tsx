import type { SteelError } from '@steel-so/sdk'
import type { Context } from '../context.js'
import { Hint, Success, Warning } from '../ui/components.js'

type Revocation =
  /** The server revoked the saved token (`204`). */
  | { status: 'revoked' }
  /** The server no longer accepted it (`401`): nothing left to revoke. */
  | { status: 'invalid' }
  /** Network or server failure: the token may still be valid. */
  | { status: 'failed'; error: SteelError }

export async function logout(ctx: Context) {
  const target = await ctx.target()
  // Only the saved token is revoked; STEEL_TOKEN belongs to the environment.
  const stored = await ctx.credentials.load(target.profileName)
  let revocation: Revocation | undefined
  if (stored) {
    const result = await ctx.client(target, stored.token).auth.revokeToken()
    revocation = result.ok
      ? { status: 'revoked' }
      : result.error.status === 401
        ? { status: 'invalid' }
        : { status: 'failed', error: result.error }
  }

  const removed = await ctx.credentials.remove(target.profileName)
  let tokenId: string | undefined
  await ctx.config.update((config) => {
    const profile = config.profiles[target.profileName]
    tokenId = profile?.session?.tokenId
    if (profile) delete profile.session
  })

  if (ctx.json) {
    ctx.printJson({
      profile: target.profileName,
      loggedOut: removed,
      ...(tokenId ? { tokenId } : {}),
      ...(revocation
        ? {
            revoked: revocation.status !== 'failed',
            ...(revocation.status === 'failed'
              ? { revokeError: revocation.error.code }
              : {}),
          }
        : {}),
    })
    return
  }

  ctx.render(
    <>
      {removed ? (
        <Success>Você saiu do perfil {target.profileName}.</Success>
      ) : (
        <Success>Nenhum login salvo no perfil {target.profileName}.</Success>
      )}
      {revocation?.status === 'revoked' ? (
        <Success>Token revogado no Steel.</Success>
      ) : null}
      {revocation?.status === 'failed' ? (
        <>
          <Warning>
            {`Não foi possível revogar o token no Steel (${revocation.error.code}).`}
          </Warning>
          <Hint>
            Ele continua válido até expirar; revogue em Configurações ›
            Segurança › Tokens de API.
          </Hint>
        </>
      ) : null}
      {ctx.env.STEEL_TOKEN ? (
        <Warning>STEEL_TOKEN continua definida neste terminal.</Warning>
      ) : null}
    </>,
  )
}
