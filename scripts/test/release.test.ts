import { describe, expect, it } from 'vitest'
import {
  bumpVersion,
  type Commit,
  inferBump,
  isPrerelease,
  isVersion,
  parseCommit,
  renderReleaseNotes,
  stampVersion,
  versionFromTag,
} from '../lib/release.js'

const commit = (subject: string, body = '', hash = 'a'.repeat(40)): Commit => ({
  hash,
  subject,
  body,
})

describe('versions', () => {
  it('recognizes SemVer and prereleases', () => {
    expect(isVersion('1.2.3')).toBe(true)
    expect(isVersion('1.2.3-rc.1')).toBe(true)
    expect(isVersion('1.2')).toBe(false)
    expect(isPrerelease('1.2.3-rc.1')).toBe(true)
    expect(isPrerelease('1.2.3')).toBe(false)
  })

  it.each([
    ['1.2.3', 'major', '2.0.0'],
    ['1.2.3', 'minor', '1.3.0'],
    ['1.2.3', 'patch', '1.2.4'],
    ['2.0.0-rc.2', 'patch', '2.0.0'],
  ] as const)('bumps %s by %s to %s', (current, kind, next) => {
    expect(bumpVersion(current, kind)).toBe(next)
  })

  it('refuses an invalid current version', () => {
    expect(() => bumpVersion('nope', 'patch')).toThrow('invalid version')
  })

  it('reads the version of a release tag', () => {
    expect(versionFromTag('v1.2.3')).toBe('1.2.3')
    expect(versionFromTag('refs/tags/v1.2.3-rc.1')).toBe('1.2.3-rc.1')
    expect(versionFromTag('1.2.3')).toBeUndefined()
    expect(versionFromTag('vnext')).toBeUndefined()
  })

  it('stamps a version into package.json', () => {
    const out = stampVersion('{"name":"x","version":"0.0.0"}', '1.0.0')
    expect(JSON.parse(out)).toEqual({ name: 'x', version: '1.0.0' })
    expect(out.endsWith('}\n')).toBe(true)
  })
})

describe('conventional commits', () => {
  it('parses type, scope, description and breaking marks', () => {
    expect(parseCommit(commit('feat(cli): add mcp'))).toMatchObject({
      type: 'feat',
      scope: 'cli',
      description: 'add mcp',
      breaking: false,
    })
    expect(parseCommit(commit('fix!: drop flag'))?.breaking).toBe(true)
    expect(
      parseCommit(commit('refactor: x', 'BREAKING CHANGE: json changed'))
        ?.breaking,
    ).toBe(true)
    expect(parseCommit(commit('Merge branch main'))).toBeUndefined()
  })

  it('infers the bump, gentler before 1.0.0', () => {
    const feat = [commit('feat: a'), commit('fix: b')]
    const breaking = [commit('feat!: a')]
    const chores = [commit('chore: a'), commit('not conventional')]
    expect(inferBump('1.0.0', breaking)).toBe('major')
    expect(inferBump('1.0.0', feat)).toBe('minor')
    expect(inferBump('1.0.0', chores)).toBe('patch')
    expect(inferBump('0.3.0', breaking)).toBe('minor')
    expect(inferBump('0.3.0', feat)).toBe('patch')
  })
})

describe('release notes', () => {
  it('groups changes by kind with commit links and a compare link', () => {
    const notes = renderReleaseNotes({
      version: '1.1.0',
      repository: 'steel-so/steel-cli',
      previousTag: 'v1.0.0',
      commits: [
        commit('feat(cli): add steel mcp', '', 'b'.repeat(40)),
        commit('fix: handle 401', '', 'c'.repeat(40)),
        commit('perf: faster tables', '', 'd'.repeat(40)),
        commit('feat!: rename --json fields', '', 'e'.repeat(40)),
        commit('chore: deps'),
      ],
    })
    expect(notes).toBe(`### Mudanças incompatíveis

- rename --json fields ([eeeeeee](https://github.com/steel-so/steel-cli/commit/${'e'.repeat(40)}))

### Novidades

- **cli:** add steel mcp ([bbbbbbb](https://github.com/steel-so/steel-cli/commit/${'b'.repeat(40)}))

### Correções

- handle 401 ([ccccccc](https://github.com/steel-so/steel-cli/commit/${'c'.repeat(40)}))

### Desempenho

- faster tables ([ddddddd](https://github.com/steel-so/steel-cli/commit/${'d'.repeat(40)}))

**Todas as mudanças:** https://github.com/steel-so/steel-cli/compare/v1.0.0...v1.1.0
`)
  })

  it('says so when nothing user-visible changed', () => {
    expect(
      renderReleaseNotes({
        version: '0.1.0',
        repository: 'r/r',
        commits: [commit('chore: x')],
      }),
    ).toBe('Manutenção interna, sem mudanças visíveis.\n')
  })
})
