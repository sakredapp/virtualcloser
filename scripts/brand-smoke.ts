import { brandFromHost, isAnyGatewayHost, slugFromBrandedHost } from '../lib/brand'

const cases = [
  'virtualcloser.com',
  'www.virtualcloser.com',
  'spencer.virtualcloser.com',
  'suitecxo.com',
  'www.suitecxo.com',
  'spencer.suitecxo.com',
  'localhost:3000',
  'preview.vercel.app',
]

for (const host of cases) {
  console.log(
    host.padEnd(32),
    '→ brand=', brandFromHost(host).key.padEnd(15),
    'gateway=', String(isAnyGatewayHost(host)).padEnd(5),
    'slug=', slugFromBrandedHost(host) ?? '—',
  )
}
