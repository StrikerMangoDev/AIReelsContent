import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import type { WorldMap as MapType } from './WorldMap'
const WorldMap = lazy(() => import('./WorldMap').then(module => ({ default: module.WorldMap })))
export function DeferredWorldMap(props: ComponentProps<typeof MapType>) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => { const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '300px' }); if (ref.current) observer.observe(ref.current); return () => observer.disconnect() }, [])
  return <div ref={ref} className="deferred-map">{visible && <Suspense fallback={<div className="map-placeholder" role="status">Loading regional activity…</div>}><WorldMap {...props} /></Suspense>}</div>
}
