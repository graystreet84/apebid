import Link from "next/link";

export function ServerHeader() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b-4 border-acid bg-black px-3 py-2 sm:px-4 sm:py-3">
      <Link href="/" className="no-underline">
        <span className="font-smash text-2xl tracking-tight text-acid drop-shadow-[3px_3px_0_#ff2d95] sm:text-4xl">
          APEBID.LOL
        </span>
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/" className="font-bold text-yell">
          board
        </Link>
        <Link href="/rules" className="font-bold text-hot">
          /rules
        </Link>
        <span className="text-[10px] font-bold uppercase tracking-wide text-white/45">
          ● live
        </span>
      </nav>
    </header>
  );
}
