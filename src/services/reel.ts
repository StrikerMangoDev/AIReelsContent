type Scene = { narration: string; onScreen: string }
export function validateNarration(script: string, scenes: Scene[]) {
  const normalize = (value: string) => value.replace(/\s*\[C\d+\]/g, '').normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!scenes.length || normalize(script) !== normalize(scenes.map(scene => scene.narration).join(' '))) throw new Error('The scene narration differs from this script. Regenerate the content before exporting video.')
}
export function captionTimeline(script: string, duration: number) {
  const words = script.replace(/\s*\[C\d+\]/g, '').trim().split(/\s+/).filter(Boolean)
  if (!words.length || !Number.isFinite(duration) || duration <= 0) throw new Error('Narration and duration are required.')
  const chunks = []
  for (let i = 0; i < words.length; i += 6) chunks.push({ text: words.slice(i, i + 6).join(' '), start: duration * i / words.length, end: duration * Math.min(i + 6, words.length) / words.length })
  return chunks
}

export function subtitles(script: string, duration: number) {
  const stamp = (seconds: number) => new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23).replace('.', ',')
  return captionTimeline(script, duration).map((item, index) => `${index + 1}\n${stamp(item.start)} --> ${stamp(item.end)}\n${item.text}`).join('\n\n')
}

export async function renderReel(audio: Blob, script: string, scenes: Scene[], progress: (value: number) => void, signal: AbortSignal) {
  validateNarration(script, scenes)
  if (!globalThis.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('Video export requires a browser with canvas recording support, such as current Chrome or Edge.')
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(value => MediaRecorder.isTypeSupported(value))
  if (!mime) throw new Error('This browser cannot export WebM. Download the voiceover and production brief instead.')
  const context = new AudioContext()
  let frame = 0
  let stream: MediaStream | undefined
  let recorder: MediaRecorder | undefined
  let source: AudioBufferSourceNode | undefined
  try {
    await context.resume()
    const buffer = await context.decodeAudioData(await audio.arrayBuffer())
    if (buffer.duration > 240 || buffer.duration < 1) throw new Error('Narration must be between 1 and 240 seconds.')
    if (signal.aborted) throw new Error('Export cancelled.')
    const captions = captionTimeline(script, buffer.duration)
    const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 1280
    const paint = canvas.getContext('2d')!
    const destination = context.createMediaStreamDestination()
    source = context.createBufferSource(); source.buffer = buffer; source.connect(destination); source.connect(context.destination)
    stream = canvas.captureStream(30)
    destination.stream.getAudioTracks().forEach(track => stream!.addTrack(track))
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 })
    const chunks: Blob[] = []
    const start = context.currentTime
    const wrap = (text: string, y: number, font: string, lineHeight: number, maxLines: number) => {
      paint.font = font
      let line = ''; let row = 0
      for (const word of text.replace(/\[C\d+\]/g, '').split(/\s+/)) {
        if (paint.measureText(`${line} ${word}`).width > 570 && line) { paint.fillText(line, 75, y + row * lineHeight); line = ''; row++; if (row >= maxLines) return }
        line += `${line ? ' ' : ''}${word}`
      }
      paint.fillText(line, 75, y + row * lineHeight)
    }
    const draw = () => {
      const time = Math.min(context.currentTime - start, buffer.duration)
      const ratio = time / buffer.duration
      // ponytail: word-weighted scene/caption timing; use forced alignment when exact word timing is required.
      const sceneWeights = scenes.map(scene => Math.max(1, scene.narration.trim().split(/\s+/).length))
      const total = sceneWeights.reduce((sum, value) => sum + value, 0)
      let accumulated = 0
      const index = Math.max(0, sceneWeights.findIndex(value => { accumulated += value; return ratio <= accumulated / total }))
      const gradient = paint.createLinearGradient(0, 0, 720, 1280); gradient.addColorStop(0, '#172d29'); gradient.addColorStop(1, '#07100e')
      paint.fillStyle = gradient; paint.fillRect(0, 0, 720, 1280)
      paint.fillStyle = '#a9e6c8'; paint.font = '24px sans-serif'; paint.fillText(`EXPLAINED  /  ${String(index + 1).padStart(2, '0')}`, 75, 170)
      paint.fillStyle = '#f4f7f2'; wrap(scenes[index]?.onScreen || 'The story, explained.', 370, 'bold 48px sans-serif', 65, 5)
      paint.fillStyle = '#b9efce'; paint.fillRect(75, 720, 80, 5)
      const caption = captions.find(item => time >= item.start && time <= item.end)
      paint.fillStyle = '#ffffff'; wrap(caption?.text || '', 850, 'bold 36px sans-serif', 52, 4)
      paint.fillStyle = '#38574b'; paint.fillRect(75, 1100, 570, 5); paint.fillStyle = '#b9efce'; paint.fillRect(75, 1100, 570 * ratio, 5)
      progress(Math.round(ratio * 100))
      frame = requestAnimationFrame(draw)
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      let failure = ''
      const stop = () => { if (recorder?.state !== 'inactive') recorder?.stop() }
      const abort = () => { failure = 'Export cancelled.'; stop() }
      const hidden = () => { if (document.hidden) { failure = 'Export paused because the tab became hidden. Keep this tab visible and retry.'; stop() } }
      signal.addEventListener('abort', abort, { once: true }); document.addEventListener('visibilitychange', hidden)
      recorder!.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      recorder!.onerror = () => { failure = 'The browser could not record this video.'; stop() }
      recorder!.onstop = () => { signal.removeEventListener('abort', abort); document.removeEventListener('visibilitychange', hidden); if (failure) reject(new Error(failure)); else resolve(new Blob(chunks, { type: mime })) }
      source!.onended = stop
      draw(); recorder!.start(1000); source!.start()
    })
    return { blob, srt: subtitles(script, buffer.duration), duration: buffer.duration }
  } finally {
    cancelAnimationFrame(frame)
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    try { source?.stop() } catch { /* Already ended. */ }
    stream?.getTracks().forEach(track => track.stop())
    await context.close()
  }
}
