import type { Context } from '../context.js'
import { Hint, Success, Warning } from '../ui/components.js'

export async function logout(ctx: Context) {
  const target = await ctx.target()
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
      {ctx.env.STEEL_TOKEN ? (
        <Warning>STEEL_TOKEN continua definida neste terminal.</Warning>
      ) : null}
      {removed ? (
        <Hint>
          O token continua válido no Steel até expirar; revogue em Ajustes ›
          Segurança › Tokens de API.
        </Hint>
      ) : null}
    </>,
  )
}
