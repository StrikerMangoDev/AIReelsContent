import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return <main className="not-found"><p className="eyebrow">404</p><h1>Page not found</h1><p>The page you’re looking for doesn’t exist.</p><Link className="button button--primary" to="/">Return home</Link></main>
}
