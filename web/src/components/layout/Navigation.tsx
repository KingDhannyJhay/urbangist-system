'use client';

import { useState, useEffect } from 'react';
import Link   from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  Search, Upload, Zap, BarChart2, Menu, X,
  LogOut, User, Shield, Bell,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Navigation() {
  const router   = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  const [open,       setOpen]       = useState(false);
  const [user,       setUser]       = useState<{ email: string; role?: string } | null>(null);
  const [scrolled,   setScrolled]   = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query,      setQuery]      = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles').select('role').eq('id', session.user.id).single();
        setUser({ email: session.user.email ?? '', role: profile?.role });
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_, session) => {
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles').select('role').eq('id', session.user.id).single();
        setUser({ email: session.user.email ?? '', role: profile?.role });
      } else { setUser(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) { router.push(`/search?q=${encodeURIComponent(query)}`); setSearchOpen(false); }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
    setOpen(false);
  };

  const navLinks = [
    { href: '/',          label: 'Discover' },
    { href: '/trending',  label: 'Trending' },
    { href: '/learn',     label: 'Learn' },
  ];

  return (
    <>
      <header className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        scrolled ? 'bg-[#0B0B0B]/95 backdrop-blur-xl border-b border-[#2A2A2A]' : 'bg-transparent',
      )}>
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-xl bg-green-500 flex items-center justify-center">
              <span className="text-[#0B0B0B] font-black text-sm" style={{ fontFamily: 'Syne, sans-serif' }}>UG</span>
            </div>
            <span className="font-black text-[#F8F8F8] hidden sm:block" style={{ fontFamily: 'Syne, sans-serif' }}>
              Urban<span className="text-green-500">Gist</span>
            </span>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map(({ href, label }) => (
              <Link key={href} href={href}
                className={cn(
                  'px-4 py-2 rounded-xl text-sm font-medium transition-colors',
                  pathname === href ? 'text-green-500 bg-green-500/10' : 'text-[#A3A3A3] hover:text-[#F8F8F8]',
                )}>
                {label}
              </Link>
            ))}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {/* Search */}
            <button onClick={() => setSearchOpen(true)}
              className="p-2 rounded-xl text-[#A3A3A3] hover:text-[#F8F8F8] hover:bg-[#1C1C1C] transition-colors">
              <Search size={18} />
            </button>

            {user ? (
              <>
                <Link href="/upload"
                  className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-[#1C1C1C] border border-[#2A2A2A] text-[#F8F8F8] hover:border-green-500/50 transition-colors">
                  <Upload size={14} /> Upload
                </Link>
                <Link href="/boost" className="hidden sm:flex btn-boost px-4 py-2 text-sm rounded-xl">
                  <Zap size={14} /> Boost
                </Link>
                <Link href="/dashboard"
                  className="p-2 rounded-xl text-[#A3A3A3] hover:text-green-500 hover:bg-[#1C1C1C] transition-colors">
                  <BarChart2 size={18} />
                </Link>
                {user.role === 'admin' && (
                  <Link href="/admin"
                    className="p-2 rounded-xl text-purple-400 hover:bg-purple-500/10 transition-colors">
                    <Shield size={18} />
                  </Link>
                )}
                <button onClick={signOut}
                  className="p-2 rounded-xl text-[#525252] hover:text-red-400 hover:bg-[#1C1C1C] transition-colors">
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <>
                <Link href="/auth/login"
                  className="hidden sm:block px-4 py-2 rounded-xl text-sm font-medium text-[#A3A3A3] hover:text-[#F8F8F8] transition-colors">
                  Log in
                </Link>
                <Link href="/auth/signup" className="btn-primary py-2 px-4 rounded-xl text-sm hidden sm:flex">
                  Sign up
                </Link>
              </>
            )}

            {/* Mobile menu toggle */}
            <button onClick={() => setOpen(o => !o)}
              className="md:hidden p-2 rounded-xl text-[#A3A3A3] hover:text-[#F8F8F8] hover:bg-[#1C1C1C] transition-colors">
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </nav>

        {/* Mobile menu */}
        {open && (
          <div className="md:hidden border-t border-[#2A2A2A] bg-[#0B0B0B]/98 backdrop-blur-xl px-4 py-4 space-y-2">
            {navLinks.map(({ href, label }) => (
              <Link key={href} href={href} onClick={() => setOpen(false)}
                className={cn('block px-4 py-3 rounded-xl text-sm font-medium',
                  pathname === href ? 'text-green-500 bg-green-500/10' : 'text-[#A3A3A3]')}>
                {label}
              </Link>
            ))}
            <div className="pt-2 border-t border-[#2A2A2A] space-y-2">
              {user ? (
                <>
                  <Link href="/upload"   onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-[#A3A3A3]"><Upload size={14}/> Upload Track</Link>
                  <Link href="/boost"    onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-[#A3A3A3]"><Zap size={14}/> Boost</Link>
                  <Link href="/dashboard" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-[#A3A3A3]"><BarChart2 size={14}/> Dashboard</Link>
                  <button onClick={signOut} className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-red-400 w-full text-left"><LogOut size={14}/> Sign out</button>
                </>
              ) : (
                <>
                  <Link href="/auth/login"  onClick={() => setOpen(false)} className="block px-4 py-3 rounded-xl text-sm text-[#A3A3A3]">Log in</Link>
                  <Link href="/auth/signup" onClick={() => setOpen(false)} className="block px-4 py-3 rounded-xl text-sm bg-green-500 text-[#0B0B0B] font-semibold text-center">Sign up free</Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Search overlay */}
      {searchOpen && (
        <div className="fixed inset-0 z-[60] bg-[#0B0B0B]/90 backdrop-blur-xl flex items-start justify-center pt-24 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setSearchOpen(false); }}>
          <form onSubmit={handleSearch} className="w-full max-w-2xl">
            <div className="relative">
              <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#525252]" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search tracks, artists, genres…"
                className="w-full pl-12 pr-12 py-4 bg-[#161616] border border-[#2A2A2A] rounded-2xl text-[#F8F8F8] placeholder:text-[#525252] text-lg focus:outline-none focus:border-green-500 transition-colors"
              />
              <button type="button" onClick={() => setSearchOpen(false)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#525252] hover:text-[#F8F8F8]">
                <X size={20} />
              </button>
            </div>
            <p className="text-xs text-[#525252] mt-3 text-center">Press Enter to search · Esc to close</p>
          </form>
        </div>
      )}
    </>
  );
}
