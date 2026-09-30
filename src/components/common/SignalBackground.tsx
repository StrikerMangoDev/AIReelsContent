import { memo, useEffect, useState } from 'react'

const glyphs = ['01X7A9', 'N4E0R2', 'K8V3T1', 'C6F9L0']
export const SignalBackground = memo(function SignalBackground() {
  const [paused, setPaused] = useState(document.hidden)
  useEffect(() => { const update = () => setPaused(document.hidden); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update) }, [])
  return <div className={`signal-rain${paused ? ' signal-rain--paused' : ''}`} aria-hidden="true">{Array.from({ length: 48 }, (_, index) => <div className="signal-rain__column" key={index} style={{ left: `${index * 2.13}%`, animationDuration: `${20 + index % 5 * 3}s`, animationDelay: `${-index * 2}s` }}>{Array.from({ length: 24 }, (_, character) => <span key={character}>{glyphs[index % 4][character % 6]}</span>)}</div>)}</div>
})
