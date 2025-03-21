const output = await Bun.build({
  entrypoints: ['./index.ts'],
  outdir: './build',
  minify: true,
  naming: '[dir]/[hash].[ext]',
})
if (output.outputs.length === 0) throw new Error('No outputs')
const buildFile = `${output.outputs[0].hash}.js`
const indexFile = Bun.file('./index.html')
let index = await indexFile.text()
index = index.replace(/\/build\/.*\.js/g, `/build/${buildFile}`)
await Bun.write('./index.html', index)
