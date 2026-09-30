import { Link } from 'react-router-dom'

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Signal AI home">
      <span className="logo__mark" aria-hidden="true"><svg width="25" height="25" viewBox="0 0 25 25" fill="none"><path d="M5 17V8M12.5 20V5M20 17V8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg></span>
      <span>Signal<span className="logo__accent">AI</span></span>
    </Link>
  )
}
