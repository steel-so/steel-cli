import { Text } from 'ink'
import type { Context } from '../context.js'
import { CliError, EXIT, fromSteelError } from '../errors.js'
import { Code, Hint, Success } from '../ui/components.js'

export interface TriggerOptions {
  endpoint?: string
}

/** `steel trigger <type>`: a test event with the catalog's sample data. */
export async function trigger(
  ctx: Context,
  type: string,
  options: TriggerOptions,
) {
  const target = await ctx.authTarget()
  const result = await ctx.client(target, target.token).webhooks.trigger({
    type,
    ...(options.endpoint ? { endpointId: options.endpoint } : {}),
  })
  if (!result.ok) {
    if (result.error.code === 'VALIDATION_ERROR') {
      throw new CliError(`Evento fora do catálogo: ${type}`, {
        code: result.error.code,
        exitCode: EXIT.USAGE,
        hint: 'Veja os tipos com `steel webhooks events`.',
        cause: result.error,
      })
    }
    throw fromSteelError(result.error, target.url)
  }
  const { event, deliveries } = result.data

  if (ctx.json) {
    ctx.printJson(result.data)
    return
  }

  ctx.render(
    <>
      <Success>
        Evento de teste <Text bold>{event.type}</Text> criado ({event.id}).
      </Success>
      <Hint>
        {deliveries > 0
          ? `${deliveries === 1 ? '1 entrega' : `${deliveries} entregas`} na fila do endpoint. `
          : ''}
        Quem está com <Code>steel listen</Code> recebe agora.
      </Hint>
    </>,
  )
}
