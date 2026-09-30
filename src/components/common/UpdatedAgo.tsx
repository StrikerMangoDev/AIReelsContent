import { useEffect, useState } from 'react'
import { Clock3 } from 'lucide-react'

export function UpdatedAgo({ timestamp }: { timestamp: string | null | undefined }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  if (!timestamp) return <span className="updated-ago">Awaiting first update</span>
  const seconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000))
  const value = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` : `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h`
  return <span className="updated-ago" title={new Date(timestamp).toLocaleString()}><Clock3 size={13} /> Updated {value} ago</span>
}
