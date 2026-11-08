import { Link } from 'react-router-dom'

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="AIReelsContent home">
      <span>AIReels<span className="logo__accent">Content</span></span>
    </Link>
  )
}
