"use client";

import WalletConnect from "./WalletConnect";

export default function NavBar() {
  return (
    <nav className="border-b border-white/10 px-6 py-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <a href="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500" />
          <span className="text-lg font-bold tracking-tight">PrivaMarket</span>
        </a>
        <div className="flex items-center gap-4">
          <a href="/" className="text-sm text-white/50 hover:text-white transition">Markets</a>
          <WalletConnect />
        </div>
      </div>
    </nav>
  );
}
