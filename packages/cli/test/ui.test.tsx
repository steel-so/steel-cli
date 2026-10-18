import { renderToString } from 'ink'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { ErrorMessage, KeyValue, Table } from '../src/ui/components.js'
import { DeviceLogin } from '../src/ui/device-login.js'
import { deviceStart } from './harness.js'

describe('components', () => {
  it('aligns key/value rows', () => {
    const out = renderToString(
      <KeyValue
        rows={[
          ['Usuário', 'Ana'],
          ['Workspace', 'Demo'],
        ]}
      />,
    )
    expect(out).toBe('Usuário    Ana\nWorkspace  Demo')
  })

  it('pads table columns under an upper-case header', () => {
    const out = renderToString(
      <Table
        columns={[
          { key: 'a', label: 'Nome' },
          { key: 'b', label: 'Valor' },
        ]}
        rows={[
          { a: 'curto', b: '1' },
          { a: 'bem mais longo', b: '22' },
        ]}
      />,
    )
    expect(out.split('\n')).toEqual([
      'NOME            VALOR',
      '──────────────  ─────',
      'curto           1',
      'bem mais longo  22',
    ])
  })

  it('shows an error with its hint', () => {
    expect(
      renderToString(<ErrorMessage message='Falhou.' hint='Tente de novo.' />),
    ).toBe('✖ Falhou.\n  › Tente de novo.')
    expect(renderToString(<ErrorMessage message='Falhou.' />)).toBe('✖ Falhou.')
  })
})

describe('DeviceLogin', () => {
  it('shows the code, the link and the spinner', () => {
    const { lastFrame, rerender } = render(
      <DeviceLogin
        device={deviceStart}
        profileName='homologacao'
        url='https://h.example'
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain(
      'Entrando no Steel (homologacao · https://h.example)',
    )
    expect(frame).toContain('ABCD-EFGH')
    expect(frame).toContain('Confirme o código no navegador:')
    expect(frame).toContain(deviceStart.verificationUriComplete)
    expect(frame).toContain('Aguardando a confirmação')

    rerender(
      <DeviceLogin
        device={deviceStart}
        profileName='homologacao'
        url='https://h.example'
        browserOpened={false}
      />,
    )
    expect(lastFrame()).toContain('Abra no navegador e confirme o código:')
  })
})
