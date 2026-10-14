// Bundles the two scripts the native app runs:
//   www/shell.js          the local shell (company entry, opening, settings)
//   www/native-inject.js  added by the native code to every hosted Suite CXO page
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Local testing only (see src/host.ts). Empty in a store build.
const devOrigin = process.env.CXO_DEV_ORIGIN ?? ''
if (devOrigin) console.warn(`\n  DEV BUILD: the app will open ${devOrigin}, not suitecxo.com. Do not ship this build.\n`)
// Which store app (src/edition.ts): CXO_EDITION=pinnacle pins Pinnacle's company. Unset is Suite CXO.
const edition = (process.env.CXO_EDITION ?? '').trim().toLowerCase() === 'pinnacle' ? 'pinnacle' : 'suite'
if (edition !== 'suite') console.warn(`\n  EDITION: ${edition} (its own bundle ID; see src/edition.ts).\n`)
const common = { define: { __CXO_DEV_ORIGIN__: JSON.stringify(devOrigin), __CXO_EDITION__: JSON.stringify(edition) }, bundle: true, format: 'iife', target: ['es2020', 'safari15'], minify: true, logLevel: 'info' }

await build({ ...common, entryPoints: [path.join(root, 'src/shell.ts')], outfile: path.join(root, 'www/shell.js') })
await build({ ...common, entryPoints: [path.join(root, 'src/inject.ts')], outfile: path.join(root, 'www/native-inject.js') })
