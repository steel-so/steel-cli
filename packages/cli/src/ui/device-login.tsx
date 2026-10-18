import type { DeviceAuthorization } from '@steel-so/sdk'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import { theme } from './theme.js'

export interface DeviceLoginState {
  device: DeviceAuthorization
  profileName: string
  url: string
  /** `undefined` while the browser is being opened. */
  browserOpened?: boolean
}

/** Live view while `steel login` waits for the user on `/device`. */
export function DeviceLogin({
  device,
  profileName,
  url,
  browserOpened,
}: DeviceLoginState) {
  return (
    <Box flexDirection='column' gap={1}>
      <Text>
        Entrando no Steel{' '}
        <Text color={theme.muted}>
          ({profileName} · {url})
        </Text>
      </Text>
      <Box
        borderStyle='round'
        borderColor={theme.brand}
        paddingX={2}
        flexDirection='column'
        alignSelf='flex-start'
      >
        <Text color={theme.muted}>Código de confirmação</Text>
        <Text color={theme.brand} bold>
          {device.userCode}
        </Text>
      </Box>
      <Box flexDirection='column'>
        <Text>
          {browserOpened === false
            ? 'Abra no navegador e confirme o código:'
            : 'Confirme o código no navegador:'}
        </Text>
        <Text color={theme.brandSoft}>{device.verificationUriComplete}</Text>
      </Box>
      <Text>
        <Text color={theme.brand}>
          <Spinner type='dots' />
        </Text>{' '}
        Aguardando a confirmação…{' '}
        <Text color={theme.muted}>(Ctrl+C cancela)</Text>
      </Text>
    </Box>
  )
}
