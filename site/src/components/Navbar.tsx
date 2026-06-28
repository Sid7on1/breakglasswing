import { ArrowUpRight } from 'lucide-react';

const LINKS = ['Overview', 'Capabilities', 'Domains', 'Docs', 'GitHub'];

export default function Navbar() {
  return (
    <nav className="fixed top-4 left-0 right-0 z-50 flex items-center justify-between px-8 lg:px-16">
      {/* logo */}
      <div className="liquid-glass flex h-12 w-12 items-center justify-center rounded-full">
        <span className="font-heading text-2xl italic leading-none text-white">b</span>
      </div>

      {/* center pill (desktop) */}
      <div className="liquid-glass hidden items-center gap-0 rounded-full px-1.5 py-1.5 lg:flex">
        {LINKS.map((link) => (
          <a
            key={link}
            href="#"
            className="rounded-full px-3 py-2 font-body text-sm font-medium text-white/90 transition-colors hover:text-white"
          >
            {link}
          </a>
        ))}
        <a
          href="#"
          className="ml-1 flex items-center gap-1 whitespace-nowrap rounded-full bg-white px-4 py-2 font-body text-sm font-medium text-black"
        >
          Install Bimax
          <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
        </a>
      </div>

      {/* spacer to balance the logo */}
      <div className="h-12 w-12 invisible" />
    </nav>
  );
}
