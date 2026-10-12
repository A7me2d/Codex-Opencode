import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const logo = await readFile(path.join(root, 'public', 'brand', 'openzero-logo.png'))
const wordmark = await readFile(path.join(root, 'public', 'brand', 'openzero-wordmark.png'))
function resizedPng(source, size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256"><image width="256" height="256" href="data:image/png;base64,${source.toString('base64')}"/></svg>`
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
await writeFile(path.join(root, 'public', 'brand', 'openzero-wordmark-256.png'), resizedPng(wordmark, 256))
await writeFile(path.join(root, 'build', 'app.ico'), ico)
