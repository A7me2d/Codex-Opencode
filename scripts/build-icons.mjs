import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const logo = await readFile(path.join(root, 'public', 'brand', 'openzero-logo-transparent.png'))
const wordmark = await readFile(path.join(root, 'public', 'brand', 'openzero-wordmark-transparent.png'))
const closedLogo = await readFile(path.join(root, 'public', 'brand', 'openzero-logo-closed.png'))
function resizedPng(source, width, height = width) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${source.toString('base64')}"/></svg>`
  return new Resvg(svg).render().asPng()
}
const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map(size => resizedPng(logo, size))
const headerSize = 6 + images.length * 16
const ico = Buffer.alloc(headerSize + images.reduce((sum, image) => sum + image.length, 0))
ico.writeUInt16LE(1, 2)
ico.writeUInt16LE(images.length, 4)
let offset = headerSize
images.forEach((image, index) => {
  const entry = 6 + index * 16
  ico.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], entry)
  ico.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], entry + 1)
  ico.writeUInt16LE(1, entry + 4)
  ico.writeUInt16LE(32, entry + 6)
  ico.writeUInt32LE(image.length, entry + 8)
  ico.writeUInt32LE(offset, entry + 12)
  image.copy(ico, offset)
  offset += image.length
})
await mkdir(path.join(root, 'build'), { recursive: true })
await writeFile(path.join(root, 'public', 'app-icon.png'), images[images.length - 1])
await writeFile(path.join(root, 'public', 'app-icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><image width="256" height="256" href="data:image/png;base64,${images[images.length - 1].toString('base64')}"/></svg>`)
await writeFile(path.join(root, 'public', 'app-icon.ico'), ico)
// The wordmark is landscape: keep its native proportions for the desktop splash.
const wordmarkHeight = Math.max(1, Math.round(512 * wordmark.readUInt32BE(20) / wordmark.readUInt32BE(16)))
await writeFile(path.join(root, 'public', 'brand', 'openzero-wordmark-256.png'), resizedPng(wordmark, 512, wordmarkHeight))
await writeFile(path.join(root, 'build', 'app.ico'), ico)

// Animate only the eyes; the original emblem stays visible and motionless.
// Raster layers are embedded so the SVG also works as an <img> and in Electron's data URL splash.
const openFrame = resizedPng(logo, 512).toString('base64')
const closedFrame = resizedPng(closedLogo, 512).toString('base64')
await writeFile(path.join(root, 'public', 'brand', 'openzero-logo-animated.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 1254 1254">
<style>.eyelids{opacity:0;animation:blink 6.2s ease-in-out infinite}@keyframes blink{0%,46%,51%,100%{opacity:0}47.5%,49.5%{opacity:1}}@media(prefers-reduced-motion:reduce){.eyelids{animation:none}}</style>
<defs><radialGradient id="feather"><stop offset="75%" stop-color="white"/><stop offset="100%" stop-color="black"/></radialGradient><mask id="eyes" maskUnits="userSpaceOnUse" x="0" y="0" width="1254" height="1254"><ellipse cx="607" cy="638" rx="105" ry="72" transform="rotate(38 607 638)" fill="url(#feather)"/><ellipse cx="769" cy="671" rx="78" ry="55" transform="rotate(-30 769 671)" fill="url(#feather)"/></mask></defs>
<image width="1254" height="1254" href="data:image/png;base64,${openFrame}"/>
<image class="eyelids" mask="url(#eyes)" width="1254" height="1254" href="data:image/png;base64,${closedFrame}"/>
</svg>`)
