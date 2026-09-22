import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [sourceCommit, ...extra] = process.argv.slice(2)
if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? '') || extra.length > 0) {
  console.error('Usage: npm run contracts:update -- <full 40-character engine commit SHA>')
  process.exitCode = 1
} else {
  await updateContracts(sourceCommit)
}

async function updateContracts(commit) {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const checkout = await mkdtemp(join(tmpdir(), 'maestro-contracts-'))
  const target = join(repository, 'contracts')

  try {
    git(['init', '--quiet'], checkout)
    git(['remote', 'add', 'origin', 'https://github.com/jasonhui1/maestro-playground.git'], checkout)
    git(['fetch', '--depth=1', 'origin', commit], checkout)

    const fetchedCommit = git(['rev-parse', 'FETCH_HEAD'], checkout).trim()
    if (fetchedCommit !== commit) throw new Error(`Fetched ${fetchedCommit}, expected ${commit}`)

    git(['checkout', 'FETCH_HEAD', '--', 'contracts'], checkout)
    const source = join(checkout, 'contracts')
    const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'))
    if (!manifest.scenarios || !manifest.capabilities) throw new Error('The pinned contracts manifest is incomplete')

    await rm(target, { recursive: true, force: true })
    await cp(source, target, { recursive: true })
    await writeFile(
      join(target, 'SOURCE.md'),
      [
        '# Fixture source',
        '',
        `Engine contracts from [maestro-playground@${commit}](https://github.com/jasonhui1/maestro-playground/commit/${commit}).`,
        '',
        'Refresh deliberately with `npm run contracts:update -- <full commit SHA>`. Tests use only these committed files.',
        '',
      ].join('\n'),
    )
    console.log(`Updated contracts from maestro-playground@${commit}`)
  } finally {
    await rm(checkout, { recursive: true, force: true })
  }
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}
