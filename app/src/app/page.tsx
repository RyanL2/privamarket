"use client";

import { useState, useEffect } from "react";
import { useMarketCount, useMarkets, useFaucet, usePrivaUSDBalance } from "@/hooks/usePrivateMarket";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import MarketCard from "@/components/MarketCard";
import CreateMarket from "@/components/CreateMarket";
import UnlinkWallet from "@/components/UnlinkWallet";

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address } = useAccount();
  const { data: count } = useMarketCount();
  const { data: markets, isLoading } = useMarkets(Number(count ?? 0));
  const { data: pusdBalance } = usePrivaUSDBalance(address);
  const { faucet, isConfirming: isFauceting } = useFaucet();

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center py-8">
        <h1 className="text-4xl font-bold tracking-tight">
          Private Prediction Markets
        </h1>
        <p className="mt-3 text-lg text-white/50 max-w-2xl mx-auto">
          Trade on outcomes without revealing your position. Powered by{" "}
          <span className="text-violet-400">Unlink</span> privacy and{" "}
          <span className="text-violet-400">Frequent Batch Auctions</span> on{" "}
          <span className="text-violet-400">Monad</span>.
        </p>
      </div>

      {/* Wallet Balance + Faucet */}
      {mounted && address && (
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-5 py-3">
          <div className="text-sm text-white/50">
            PrivaUSD Balance:{" "}
            <span className="font-mono text-white font-semibold">
              {mounted && pusdBalance ? Number(formatEther(pusdBalance)).toFixed(2) : "0"}
            </span>
            <span className="text-white/40 ml-1">PUSD</span>
          </div>
          <button
            onClick={() => faucet("1000")}
            disabled={isFauceting}
            className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 px-4 py-1.5 text-xs font-medium text-white transition"
          >
            {isFauceting ? "Minting..." : "Get 1,000 PUSD"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Markets List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Markets</h2>
            <span className="text-sm text-white/40">{markets?.length ?? 0} active</span>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-5 h-32 animate-pulse" />
              ))}
            </div>
          ) : markets && markets.length > 0 ? (
            <div className="space-y-3">
              {markets.map((m) => (
                <MarketCard key={m.id} market={m} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/30">
              No markets yet. Create one to get started.
            </div>
          )}

          {/* Create Market */}
          <CreateMarket />
        </div>

        {/* Privacy Wallet Sidebar */}
        <div className="space-y-4">
          <UnlinkWallet />
        </div>
      </div>
    </div>
  );
}
