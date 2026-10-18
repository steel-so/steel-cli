/** One single-file binary built by `bun build --compile`. */
export interface Target {
  /** Name in assets and in `--target`: `<os>-<arch>`. */
  id: string
  /** `bun build --compile --target` value. */
  bun: string
  os: 'linux' | 'darwin' | 'windows'
  arch: 'x64' | 'arm64'
  /** GitHub-hosted runner that builds it natively (the keychain addon is native). */
  runner: string
  executable: string
  archive: 'tar.gz' | 'zip'
}

// x64 uses Bun's baseline build: it runs on CPUs without AVX2 too.
export const TARGETS: readonly Target[] = [
  {
    id: 'linux-x64',
    bun: 'bun-linux-x64-baseline',
    os: 'linux',
    arch: 'x64',
    runner: 'ubuntu-24.04',
    executable: 'steel',
    archive: 'tar.gz',
  },
  {
    id: 'linux-arm64',
    bun: 'bun-linux-arm64',
    os: 'linux',
    arch: 'arm64',
    runner: 'ubuntu-24.04-arm',
    executable: 'steel',
    archive: 'tar.gz',
  },
  {
    id: 'darwin-x64',
    bun: 'bun-darwin-x64-baseline',
    os: 'darwin',
    arch: 'x64',
    runner: 'macos-15-intel',
    executable: 'steel',
    archive: 'tar.gz',
  },
  {
    id: 'darwin-arm64',
    bun: 'bun-darwin-arm64',
    os: 'darwin',
    arch: 'arm64',
    runner: 'macos-15',
    executable: 'steel',
    archive: 'tar.gz',
  },
  {
    id: 'windows-x64',
    bun: 'bun-windows-x64-baseline',
    os: 'windows',
    arch: 'x64',
    runner: 'windows-2025',
    executable: 'steel.exe',
    archive: 'zip',
  },
]

/** `steel-linux-x64.tar.gz`: no version, so `releases/latest/download/` works. */
export function assetName(target: Target): string {
  return `steel-${target.id}.${target.archive}`
}

export function findTarget(id: string): Target | undefined {
  return TARGETS.find((target) => target.id === id)
}

/** The target of the machine running the build. */
export function hostTargetId(platform: string, arch: string): string {
  const os = platform === 'win32' ? 'windows' : platform
  return `${os}-${arch}`
}
