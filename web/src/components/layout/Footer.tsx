import Link from 'next/link';

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-[#2A2A2A] bg-[#0B0B0B] mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-green-500 flex items-center justify-center">
                <span className="text-[#0B0B0B] font-black text-xs" style={{ fontFamily: 'Syne, sans-serif' }}>UG</span>
              </div>
              <span className="font-black text-[#F8F8F8] text-sm" style={{ fontFamily: 'Syne, sans-serif' }}>UrbanGist</span>
            </div>
            <p className="text-xs text-[#525252] leading-relaxed">
              Nigeria's home for Afrobeats, Amapiano, Afrorap &amp; Gospel.
            </p>
          </div>

          {[
            {
              title: 'Discover', links: [
                { href: '/',          label: 'Home' },
                { href: '/trending',  label: 'Trending' },
                { href: '/search',    label: 'Search' },
              ],
            },
            {
              title: 'Artists', links: [
                { href: '/upload',    label: 'Upload Track' },
                { href: '/boost',     label: 'Boost Track' },
                { href: '/dashboard', label: 'Dashboard' },
                { href: '/learn',     label: 'Artist Guides' },
              ],
            },
            {
              title: 'Company', links: [
                { href: '/about',          label: 'About' },
                { href: '/contact',        label: 'Contact' },
                { href: '/privacy',        label: 'Privacy' },
                { href: '/terms',          label: 'Terms' },
                { href: '/content-policy', label: 'Content Policy' },
              ],
            },
          ].map(section => (
            <div key={section.title}>
              <h4 className="text-xs font-bold text-[#F8F8F8] uppercase tracking-widest mb-3">{section.title}</h4>
              <ul className="space-y-2">
                {section.links.map(({ href, label }) => (
                  <li key={href}>
                    <Link href={href} className="text-xs text-[#525252] hover:text-[#A3A3A3] transition-colors">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="pt-6 border-t border-[#2A2A2A] flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-[#525252]">© {year} UrbanGist Media. All rights reserved.</p>
          <p className="text-xs text-[#525252]">Built for Nigerian artists 🇳🇬</p>
        </div>
      </div>
    </footer>
  );
}
