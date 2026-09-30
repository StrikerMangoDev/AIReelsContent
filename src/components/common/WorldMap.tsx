import { geoContains, geoNaturalEarth1, geoPath } from 'd3-geo'
import { memo } from 'react'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import atlas from 'world-atlas/countries-110m.json'
import type { ActivityCount } from '@/types/news'

const topology = atlas as unknown as Topology<{ countries: GeometryCollection }>
const land = feature(topology, topology.objects.countries)
const projection = geoNaturalEarth1().fitSize([900, 440], land)
const path = geoPath(projection)
const countryPaths = land.features.map(country => path(country) ?? '')
const MapLand = memo(function MapLand() { return <g className="map-countries">{countryPaths.map((outline, index) => <path key={index} d={outline} />)}</g> })
const regionGeometry: Record<string, { ids: string[]; bounds: [number, number, number, number] }> = {
  'United States': { ids: ['840'], bounds: [-124, 26, -68, 49] },
  India: { ids: ['356'], bounds: [69, 8, 89, 35] },
  China: { ids: ['156'], bounds: [78, 20, 130, 49] },
  Europe: { ids: ['250', '276', '724', '380', '616', '752', '578', '246', '528', '040', '203'], bounds: [-9, 37, 30, 66] },
  Japan: { ids: ['392'], bounds: [129, 31, 145, 45] },
  'United Kingdom': { ids: ['826'], bounds: [-7, 50, 2, 59] },
}
const markerCache = new Map<string, [number, number][]>()
function positionsFor(region: string) {
  const cached = markerCache.get(region)
  if (cached) return cached
  const geometry = regionGeometry[region]
  const countries = land.features.filter(country => geometry.ids.includes(String(country.id).padStart(3, '0')))
  const [west, south, east, north] = geometry.bounds
  const candidates: [number, number][] = []
  for (let row = 0; row < 22; row++) for (let column = 0; column < 35; column++) {
    const coordinates: [number, number] = [west + (column + .5) / 35 * (east - west), south + (row + .5) / 22 * (north - south)]
    if (countries.some(country => geoContains(country, coordinates))) candidates.push(projection(coordinates)! as [number, number])
  }
  // Deterministic spacing; markers express country attribution, not exact cities.
  markerCache.set(region, candidates)
  return candidates
}
const hotspots: { region: string; coordinates: [number, number] }[] = [
  { region: 'United States', coordinates: [-100, 39] },
  { region: 'India', coordinates: [78, 23] },
  { region: 'China', coordinates: [104, 35] },
  { region: 'Europe', coordinates: [15, 48] },
  { region: 'Japan', coordinates: [139, 36] },
  { region: 'United Kingdom', coordinates: [-3, 55] },
]

export function WorldMap({ region, onSelect, activity }: { region: string; onSelect: (region: string) => void; activity?: ActivityCount[] }) {
  return <div className="geographic-map"><svg viewBox="0 0 900 440" role="img" aria-label="World map showing selectable AI activity regions">
    <defs><pattern id="map-grid" width="45" height="44" patternUnits="userSpaceOnUse"><path d="M45 0H0V44" fill="none" stroke="#fff" strokeOpacity=".04" /></pattern></defs>
    <rect width="900" height="440" fill="url(#map-grid)" />
    <MapLand />
    <g className="activity-dots" aria-hidden="true">{hotspots.flatMap(hotspot => {
      const count = activity?.find(item => item.region === hotspot.region)?.total ?? 0
      if (!count) return []
      const positions = positionsFor(hotspot.region)
      const dots = Math.min(count, positions.length, 80)
      return Array.from({ length: dots }, (_, index) => {
        const point = positions[Math.floor((index + .5) / dots * positions.length)]
        return <circle key={`${hotspot.region}-${index}`} cx={point[0]} cy={point[1]} r={region === hotspot.region ? 3 : 2.2} className={region === hotspot.region ? 'is-selected' : ''}><title>{hotspot.region}: regional update (approximate placement)</title></circle>
      })
    })}</g>
    {hotspots.map(hotspot => {
      const point = projection(hotspot.coordinates)!
      const count = activity?.find(item => item.region === hotspot.region)?.total
      return <g key={hotspot.region} className={`map-hotspot ${region === hotspot.region ? 'is-selected' : ''}`} transform={`translate(${point[0]},${point[1]})`} role="button" tabIndex={0} aria-label={`Select ${hotspot.region}; ${count ?? 'pending'} updates`} onClick={() => onSelect(hotspot.region)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(hotspot.region) } }}><title>{hotspot.region} · {count ?? 'Pending'} updates</title><circle className="hotspot-target" r="18" /><text x="13" y={hotspot.region === 'United Kingdom' ? -15 : 5}>{hotspot.region === 'United States' ? 'US' : hotspot.region === 'United Kingdom' ? 'UK' : hotspot.region} {count ?? ''}</text></g>
    })}
  </svg><div className="map-legend"><span><i /> One dot per regional update, up to 80</span><span>Placement within region is approximate</span></div></div>
}
