import { Plus, LayoutGrid, FolderOpen, CalendarDays, Menu, X, ChevronDown, ArrowUpRight, Users, Gauge } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Logo } from '@/components/common/Logo'
import { useAuth } from '@/context/auth-state'
import { activeWorkspace, subscribeWorkspace } from '@/services/workspace-session'
import { signOutCurrentUser } from '@/services/firebase'
import '@/styles/workspace.css'

const navigation = [
  { to: '/ideas', label: 'Topic Library', description: 'Browse categories & researched ideas', Icon: LayoutGrid },
  { to: '/studio', label: 'Content Studio', description: 'Write, preview & download', Icon: FolderOpen },
  { to: '/planning', label: 'Content Planner', description: 'Organize work by stage & date', Icon: CalendarDays },
]

export function AppLayout() {
  const { identity } = useAuth()
  const workspace = useSyncExternalStore(subscribeWorkspace, activeWorkspace, () => 'personal')
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState('')
  const title = pathname.startsWith('/ideas') ? 'Topic Library' : pathname.startsWith('/studio-review') ? 'Review content' : pathname.startsWith('/studio') ? 'Content Studio' : pathname.startsWith('/planning') ? 'Content Planner' : pathname.startsWith('/workspaces') ? 'Team & access' : pathname.startsWith('/usage') ? 'Usage & limits' : pathname.startsWith('/dashboard') ? 'Top ideas' : pathname.startsWith('/insights') ? 'Website insights' : pathname.startsWith('/admin') ? 'Administration' : 'Find new ideas'
  const closeMenu = () => setMenuOpen(false)
  return <div className="workspace-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="workspace-mobile-header"><Logo /><button ref={menuButton} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X aria-hidden="true" size={22} /> : <Menu aria-hidden="true" size={22} />}</button></header>
    <aside id="workspace-navigation" className={`workspace-sidebar${menuOpen ? ' is-open' : ''}`} onKeyDown={event => { if (event.key === 'Escape') { closeMenu(); menuButton.current?.focus() } }}>
      <div className="workspace-brand"><Logo /></div>
      <Link to="/workspaces" onClick={closeMenu} className="workspace-switcher"><span><strong>{workspace === 'personal' ? 'Personal workspace' : 'Team workspace'}</strong><small>{workspace === 'personal' ? 'Your personal research & drafts' : 'Shared with workspace members'}</small><span>Change workspace <ArrowUpRight aria-hidden="true" size={13} /></span></span></Link>
      <NavLink to="/find-ideas" end className="workspace-create" onClick={closeMenu}><Plus aria-hidden="true" size={18} /> Find new ideas</NavLink>
      <span className="workspace-nav-label">Your content</span>
      <nav aria-label="Main navigation" className="workspace-nav">{navigation.map(({ to, label, description, Icon }) => <NavLink key={to} to={to} className={({ isActive }) => isActive || (to === '/studio' && pathname.startsWith('/studio-review')) ? 'active' : undefined} onClick={closeMenu}><Icon aria-hidden="true" size={20} /><span><strong>{label}</strong><small>{description}</small></span></NavLink>)}</nav>
      <nav className="workspace-secondary" aria-label="Workspace settings"><NavLink to="/workspaces" onClick={closeMenu}><Users aria-hidden="true" size={17} /> Team & access</NavLink><NavLink to="/usage" onClick={closeMenu}><Gauge aria-hidden="true" size={17} /> Usage & limits</NavLink><details><summary>More <ChevronDown aria-hidden="true" size={15} /></summary><nav aria-label="More navigation"><NavLink to="/dashboard" onClick={closeMenu}>Top ideas</NavLink><NavLink to="/insights" onClick={closeMenu}>Website insights</NavLink>{identity?.role === 'admin' && <NavLink to="/admin" onClick={closeMenu}>Administration</NavLink>}</nav></details></nav>
      <div className="workspace-account"><span className="workspace-avatar" aria-hidden="true">{identity?.name?.slice(0, 1).toUpperCase() || (identity ? 'W' : 'A')}</span><div><strong>{identity ? identity.name || 'Your account' : 'Welcome to AIReels'}</strong><span>{identity ? 'Signed in' : 'Sign in to save your work'}</span></div>{identity ? <button onClick={async () => { try { await signOutCurrentUser(); closeMenu() } catch { setError('Could not sign out. Please try again.') } }}>Sign out</button> : <Link to="/login" onClick={closeMenu}>Sign in</Link>}</div>
    </aside>
    <div className="workspace-body"><header className="workspace-topbar"><span>{title}</span><Link to="/workspaces">{workspace === 'personal' ? 'Personal workspace' : 'Shared workspace'} <ArrowUpRight aria-hidden="true" size={14} /></Link></header>
      <main id="main-content" tabIndex={-1} className="workspace-main">{error && <p role="alert" className="workspace-error">{error}</p>}<Outlet key={`${identity?.uid || 'guest'}:${workspace}`} /></main>
    </div>
  </div>
}
