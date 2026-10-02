import { Menu, Search, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { Logo } from '@/components/common/Logo'
import { SignalBackground } from '@/components/common/SignalBackground'
import { RegionPicker } from '@/components/ui/RegionPicker'
import { useAuth } from '@/context/auth-state'
import { configuredAuth } from '@/services/firebase'

export function AppLayout() {
  const { identity } = useAuth()
  const isFeed = useLocation().pathname === '/dashboard'
  const [searchParams, setSearchParams] = useSearchParams()
  const region = searchParams.get('region') ?? 'Global'
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const updateSearch = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('q', value)
    else next.delete('q')
    next.delete('page')
    setSearchParams(next, { replace: true })
  }
  const changeRegion = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'Global') next.delete('region')
    else next.set('region', value)
    next.delete('page')
    next.delete('category'); next.delete('q')
    setSearchParams(next)
  }
  return (
    <div className="app-shell app-shell--dark">
      <SignalBackground />
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="glass-header">
        <div className="glass-header__shine" aria-hidden="true" /><Logo />
        <nav className="glass-header__nav" aria-label="Main navigation">
          <NavLink to="/" end>Research desk</NavLink><NavLink to="/studio">Content library</NavLink><NavLink to="/dashboard">AI news feed</NavLink><NavLink to="/insights">Insights</NavLink>
        </nav>
        <div className="glass-header__actions">
          {isFeed && <><button className="header-search" aria-label={searchOpen ? 'Close search' : 'Search news'} aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}>{searchOpen ? <X size={18} /> : <Search size={18} />}</button><RegionPicker value={region} onChange={changeRegion} /></>}
          {identity?.role === 'admin' && <NavLink className="header-account" to="/admin">Admin</NavLink>}
          {identity ? <button className="header-account header-signout" onClick={async () => { const { signOut } = await import('firebase/auth'); await signOut(await configuredAuth()) }}>Sign out</button> : <NavLink className="header-account" to="/login">Sign in</NavLink>}
          <button className="header-menu" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </header>
      {menuOpen && <nav id="mobile-navigation" className="mobile-navigation" aria-label="Mobile navigation">{[['Research desk', '/'], ['Content library', '/studio'], ['AI news feed', '/dashboard'], ['Insights', '/insights']].map(([label, href]) => <NavLink to={href} key={href} onClick={() => setMenuOpen(false)}>{label}</NavLink>)}</nav>}
      {searchOpen && isFeed && <div className="search-dock"><Search size={18} /><input autoFocus aria-label="Search headlines" placeholder="Search headlines, subjects, sources…" value={searchParams.get('q') ?? ''} onChange={(event) => updateSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false) }} /><button onClick={() => { updateSearch(''); setSearchOpen(false) }} aria-label="Clear and close search"><X size={16} /></button></div>}
      <div className="ambient ambient--one" aria-hidden="true" /><div className="ambient ambient--two" aria-hidden="true" />
      <main id="main-content" className="app-main"><div className="page-content"><Outlet /></div></main>
    </div>
  )
}
