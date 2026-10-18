import { Text } from 'ink'
import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { Hint, Success } from '../ui/components.js'
import { symbols, theme } from '../ui/theme.js'
import { toCliError } from './data.js'
import {
  Confirm,
  Loading,
  type SelectChoice,
  SelectList,
  TextInput,
} from './widgets.js'

/**
 * One step of a detail action (comment, move): ask, confirm, run, report.
 * Anything but `idle` and `result` owns the keyboard.
 */
export type FlowStep =
  | { kind: 'idle' }
  | {
      kind: 'text'
      label: string
      placeholder?: string
      footer?: ReactNode
      extra?: (input: string, key: { tab: boolean }) => boolean
      onSubmit(value: string): void
    }
  | {
      kind: 'select'
      label: string
      choices: SelectChoice[]
      onSubmit(value: string): void
    }
  | { kind: 'confirm'; question: string; onYes(): void }
  | { kind: 'busy'; label: string }
  | { kind: 'result'; tone: 'success' | 'error'; text: string; hint?: string }

export function capturesKeys(step: FlowStep): boolean {
  return step.kind !== 'idle' && step.kind !== 'result'
}

export function useFlow(onChanged: () => void) {
  const [step, setStep] = useState<FlowStep>({ kind: 'idle' })
  const cancel = useCallback(() => setStep({ kind: 'idle' }), [])

  /** Runs `action` after "yes"; its return value is the success line. */
  const confirmThenRun = useCallback(
    (question: string, busy: string, action: () => Promise<string>) => {
      setStep({
        kind: 'confirm',
        question,
        onYes: () => {
          setStep({ kind: 'busy', label: busy })
          action().then(
            (text) => {
              setStep({ kind: 'result', tone: 'success', text })
              onChanged()
            },
            (error: unknown) => {
              const cliError = toCliError(error)
              setStep({
                kind: 'result',
                tone: 'error',
                text: cliError.message,
                hint: cliError.hint,
              })
            },
          )
        },
      })
    },
    [onChanged],
  )

  return { step, setStep, cancel, confirmThenRun }
}

export function FlowView({
  step,
  onCancel,
}: {
  step: FlowStep
  onCancel(): void
}) {
  switch (step.kind) {
    case 'idle':
      return null
    case 'text':
      return (
        <TextInput
          label={step.label}
          placeholder={step.placeholder}
          footer={step.footer}
          extra={step.extra}
          onSubmit={step.onSubmit}
          onCancel={onCancel}
        />
      )
    case 'select':
      return (
        <SelectList
          label={step.label}
          choices={step.choices}
          onSubmit={step.onSubmit}
          onCancel={onCancel}
        />
      )
    case 'confirm':
      return (
        <Confirm
          question={step.question}
          onAnswer={(yes) => (yes ? step.onYes() : onCancel())}
        />
      )
    case 'busy':
      return <Loading label={step.label} />
    case 'result':
      return step.tone === 'success' ? (
        <Success>{step.text}</Success>
      ) : (
        <>
          <Text>
            <Text color={theme.danger} bold>
              {symbols.error}
            </Text>{' '}
            {step.text}
          </Text>
          {step.hint ? <Hint>{step.hint}</Hint> : null}
        </>
      )
  }
}
