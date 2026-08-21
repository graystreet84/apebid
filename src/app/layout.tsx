import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { ServerHeader } from "@/components/ServerChrome";
import Footer from "@/components/Footer";
import { Ticker } from "@/components/Ticker";
import {
  upsertVisitor,
  visitorStats,
  revenueStats,
  emptyStats,
} from "@/lib/store";

export const dynamic = "force-dynamic";

const OG = "Where will you be on the leaderboard when this goes viral?";

export const metadata: Metadata = {
  title: "apebid.lol",
  description: OG,
  robots: { index: false, follow: false },
  openGraph: {
    title: "apebid.lol",
    description: OG,
    siteName: "apebid.lol",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "apebid.lol",
    description: OG,
  },
};

async function tickerInitial() {
  try {
    const jar = await cookies();
    const hdrs = await headers();
    const id =
      jar.get("apebid-visitor-id")?.value ||
      hdrs.get("x-apebid-visitor-id") ||
      "";
    if (id) await upsertVisitor(id);
    const [v, r] = await Promise.all([visitorStats(), revenueStats()]);
    return {
      live: v.live,
      last12h: v.last12h,
      sinceLaunch: v.sinceLaunch,
      revenueSol: r.revenueSol,
    };
  } catch {
    const e = emptyStats();
    return {
      live: e.live,
      last12h: e.last12h,
      sinceLaunch: e.sinceLaunch,
      revenueSol: e.revenueSol,
    };
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const initial = await tickerInitial();
  return (
    <html lang="en" className="dark">
      <body className="dark min-h-screen bg-ink font-meme text-white">
        <ServerHeader />
        <Ticker initial={initial} />
        {children}
        <Footer />
      </body>
    </html>
  );
}
