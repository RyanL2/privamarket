"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useMarket, useBatchResult } from "@/hooks/usePrivateMarket";
import { formatEther } from "viem";
import OrderForm from "@/components/OrderForm";
import BatchTimer from "@/components/BatchTimer";
import UnlinkWallet from "@/components/UnlinkWallet";
import PriceChart from "@/components/PriceChart";

const OUTCOME_LABELS = ["Unresolved", "YES", "NO"] as const;

export default function MarketPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const params = useParams();
  const marketId = Number(params.id);
  const { data: market, isLoading } = useMarket(marketId);

  // Get last few batch results
  const prevBatchId = market ? Math.max(0, Number(market.currentBatchId) - 1) : 0;
  const { data: lastBatch } = useBatchResult(marketId, prevBatchId);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-white/5 rounded w-2/3" />
        <div className="h-64 bg-white/5 rounded-xl" />
      </div>
    );
  }

  if (!market) {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl text-white/50">Market not found</h2>
        <a href="/" className="text-violet-400 hover:text-violet-300 text-sm mt-2 inline-block">
          Back to markets
        </a>
      </div>
    );
  }

  const resolutionDate = new Date(Number(market.resolutionTime) * 1000);
  const isResolved = market.resolved !== 0;
  const lastPrice = lastBatch?.clearingPrice ? Number(lastBatch.clearingPrice) / 100 : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <a href="/" className="text-sm text-white/40 hover:text-white/60 transition">
          &larr; All Markets
        </a>
        <h1 className="text-2xl font-bold mt-2">{market.question}</h1>
        <div className="flex items-center gap-4 mt-2 text-sm text-white/40">
          <span>
            Resolves: {mounted ? resolutionDate.toLocaleDateString() : "—"}
          </span>
          {isResolved && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              market.resolved === 1 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
            }`}>
              Resolved: {OUTCOME_LABELS[market.resolved]}
            </span>
          )}
        </div>
      </div>

      {/* Price display */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
          <div className="text-xs text-emerald-400/60 mb-1 uppercase tracking-wider">YES</div>
          <div className="text-3xl font-bold font-mono text-emerald-400">
            {lastPrice ? `${lastPrice.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5 text-center">
          <div className="text-xs text-red-400/60 mb-1 uppercase tracking-wider">NO</div>
          <div className="text-3xl font-bold font-mono text-red-400">
            {lastPrice ? `${(100 - lastPrice).toFixed(1)}%` : "—"}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg bg-white/5 p-3 text-center">
          <div className="text-xs text-white/40">Pool</div>
          <div className="text-sm font-mono font-semibold mt-1">
            {Number(formatEther(market.collateralPool)).toFixed(2)} PUSD
          </div>
        </div>
        <div className="rounded-lg bg-white/5 p-3 text-center">
          <div className="text-xs text-white/40">Batch</div>
          <div className="text-sm font-mono font-semibold mt-1">
            #{Number(market.currentBatchId)}
          </div>
        </div>
        <div className="rounded-lg bg-white/5 p-3 text-center">
          <div className="text-xs text-white/40">Interval</div>
          <div className="text-sm font-mono font-semibold mt-1">
            {Number(market.batchInterval)}s
          </div>
        </div>
        <div className="rounded-lg bg-white/5 p-3 text-center">
          <div className="text-xs text-white/40">Last Clear Price</div>
          <div className="text-sm font-mono font-semibold mt-1">
            {lastBatch && lastBatch.clearingPrice > 0n
              ? `${(Number(lastBatch.clearingPrice) / 100).toFixed(1)}%`
              : "—"}
          </div>
        </div>
      </div>

      {/* Price History Chart */}
      <PriceChart marketId={marketId} currentBatchId={Number(market.currentBatchId)} />

      {/* Last batch volume */}
      {lastBatch && lastBatch.timestamp > 0n && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-sm font-semibold text-white/60 mb-2">Last Batch (#{prevBatchId})</h3>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-white/40">Clearing Price: </span>
              <span className="font-mono">{(Number(lastBatch.clearingPrice) / 100).toFixed(1)}%</span>
            </div>
            <div>
              <span className="text-white/40">YES Vol: </span>
              <span className="font-mono">{Number(formatEther(lastBatch.yesVolume)).toFixed(2)} PUSD</span>
            </div>
            <div>
              <span className="text-white/40">NO Vol: </span>
              <span className="font-mono">{Number(formatEther(lastBatch.noVolume)).toFixed(2)} PUSD</span>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Order Form */}
        <div className="lg:col-span-1">
          {!isResolved ? (
            <OrderForm marketId={marketId} question={market.question} />
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-center text-white/40">
              Market resolved. Redeem winning tokens.
            </div>
          )}
        </div>

        {/* Batch Timer */}
        <div className="lg:col-span-1">
          <BatchTimer
            marketId={marketId}
            batchInterval={Number(market.batchInterval)}
            lastClearTime={Number(market.lastClearTime)}
          />
        </div>

        {/* Privacy Wallet */}
        <div className="lg:col-span-1">
          <UnlinkWallet />
        </div>
      </div>
    </div>
  );
}
