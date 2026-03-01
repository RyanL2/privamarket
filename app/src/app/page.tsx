"use client";

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useMarketCount, useMarkets, useWMonBalance } from "@/hooks/usePrivateMarket";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { formatEther } from "viem";
import MarketCard from "@/components/MarketCard";
import CreateMarket from "@/components/CreateMarket";
import { CONTRACTS, isConfiguredAddress, monadTestnet } from "@/lib/config";
import { PRIVATEMARKET_ABI } from "@/lib/contracts";

const UnlinkWallet = dynamic(() => import("@/components/UnlinkWallet"), { ssr: false });

interface BatchResultSummary {
  clearingPrice: bigint;
  yesVolume: bigint;
  noVolume: bigint;
  timestamp: bigint;
}

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address } = useAccount();
  const { data: count, isLoading: isCountLoading } = useMarketCount();
  const { data: markets, isLoading: isMarketsLoading } = useMarkets(Number(count ?? 0));
  const marketsLoading = isCountLoading || (count !== undefined && isMarketsLoading);
  const { data: monBalance } = useBalance({
    address,
    chainId: monadTestnet.id,
    query: { enabled: !!address },
  });
  const { data: wmonBalance } = useWMonBalance(address);
  const wmonConfigured = isConfiguredAddress(CONTRACTS.WMON);
  const previousBatchContracts = useMemo(
    () =>
      (markets ?? []).map((m) => ({
        address: CONTRACTS.PRIVATE_MARKET,
        abi: PRIVATEMARKET_ABI,
        functionName: "getBatchResult" as const,
        args: [BigInt(m.id), m.currentBatchId > 0n ? m.currentBatchId - 1n : 0n] as const,
      })),
    [markets],
  );
  const { data: previousBatchData } = useReadContracts({
    contracts: previousBatchContracts,
    query: {
      enabled: previousBatchContracts.length > 0,
      staleTime: 15000,
      refetchInterval: 15000,
      refetchOnWindowFocus: false,
    },
  });
  const previousBatchByMarket = useMemo(() => {
    const mapped = new Map<number, BatchResultSummary | null>();

    (markets ?? []).forEach((market, i) => {
      const result = previousBatchData?.[i];
      if (result?.status === "success" && result.result) {
        const batch = result.result as unknown as BatchResultSummary;
        mapped.set(market.id, batch.timestamp > 0n ? batch : null);
      } else {
        mapped.set(market.id, null);
      }
    });

    return mapped;
  }, [markets, previousBatchData]);

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

      {/* Wallet Balances */}
      {mounted && address && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-3">
          <div className="text-sm text-white/50">
            <span className="mr-4">
              MON:{" "}
              <span className="font-mono text-white font-semibold">
                {monBalance ? Number(formatEther(monBalance.value)).toFixed(2) : "0"}
              </span>
            </span>
            <span>
              WMON:{" "}
              <span className="font-mono text-white font-semibold">
                {wmonConfigured && wmonBalance ? Number(formatEther(wmonBalance)).toFixed(2) : "—"}
              </span>
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Markets List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Markets</h2>
            <span className="text-sm text-white/40">
              {marketsLoading ? "Loading..." : `${markets?.length ?? 0} active`}
            </span>
          </div>

          {marketsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-5 h-36 animate-pulse" />
              ))}
            </div>
          ) : markets && markets.length > 0 ? (
            <div className="space-y-3">
              {markets.map((m) => (
                <MarketCard key={m.id} market={m} previousBatch={previousBatchByMarket.get(m.id) ?? null} />
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
