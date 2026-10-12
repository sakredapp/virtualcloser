// Draws the icon, splash and in-app mark from the Suite CXO wordmark
// (resources/logo-source.png, black on transparent) in the black and silver look.
// `npm run assets` runs this, then @capacitor/assets cuts every platform size.
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GROUND = '#0E0F11'
const src = path.join(root, 'resources/logo-source.png')

/** The wordmark, trimmed, recoloured with a soft silver gradient, `width` px wide. */
async function silverMark(width) {
  const trimmed = await sharp(src).trim().resize({ width }).png().toBuffer()
  const { width: w, height: h } = await sharp(trimmed).metadata()
  const gradient = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#F2F3F5"/><stop offset="0.55" stop-color="#C9CDD2"/><stop offset="1" stop-color="#9DA3AA"/>` +
      `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  )
  return sharp(gradient).composite([{ input: trimmed, blend: 'dest-in' }]).png().toBuffer()
}

async function canvas(size, background, markWidth, out) {
  const base = sharp({ create: { width: size, height: size, channels: 4, background } })
  const layers = markWidth ? [{ input: await silverMark(markWidth), gravity: 'centre' }] : []
  await base.composite(layers).png().toFile(path.join(root, out))
  console.log('wrote', out)
}

const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 }
await canvas(1024, GROUND, 760, 'resources/icon-only.png')
await canvas(1024, GROUND, 0, 'resources/icon-background.png')
await canvas(1024, CLEAR, 560, 'resources/icon-foreground.png') // inside the adaptive-icon safe zone
await canvas(2732, GROUND, 900, 'resources/splash.png')
await canvas(2732, GROUND, 900, 'resources/splash-dark.png')
await canvas(504, CLEAR, 480, 'www/mark.png')
