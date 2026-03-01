"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatEther } from "viem";
import type { MarketData } from "@/hooks/usePrivateMarket";

const OUTCOME_LABELS = ["Unresolved", "YES", "NO"] as const;

export default function MarketCard({ market }: { market: MarketData }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const resolutionDate = new Date(Number(market.resolutionTime) * 1000);
  const isResolved = market.resolved !== 0;
  const daysLeft = mounted
    ? Math.max(0, Math.ceil((resolutionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <Link
      href={`/market/${market.id}`}
      className="group block rounded-xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-violet-500/30 hover:bg-white/[0.05]"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-medium text-white leading-snug group-hover:text-violet-300 transition">
          {market.question}
        </h3>
        {isResolved && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            market.resolved === 1 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
          }`}>
            {OUTCOME_LABELS[market.resolved]}
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-white/5 p-2.5 text-center">
          <div className="text-xs text-white/40 mb-0.5">Pool</div>
          <div className="text-sm font-mono font-semibold text-white">
            {Number(formatEther(market.collateralPool)).toFixed(2)}
            <span className="text-xs text-white/40 ml-0.5">PUSD</span>
          </div>
        </div>
        <div className="rounded-lg bg-white/5 p-2.5 text-center">
          <div className="text-xs text-white/40 mb-0.5">Batch</div>
          <div className="text-sm font-mono font-semibold text-white">
            #{Number(market.currentBatchId)}
          </div>
        </div>
        <div className="rounded-lg bg-white/5 p-2.5 text-center">
          <div className="text-xs text-white/40 mb-0.5">Resolves</div>
          <div className="text-sm font-mono font-semibold text-white">
            {isResolved ? "Done" : mounted ? `${daysLeft}d` : "—"}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-white/30">
        <span>Batch interval: {Number(market.batchInterval)}s</span>
        <span className="text-violet-400 group-hover:text-violet-300">
          Trade →
        </span>
      </div>
    </Link>
  );
}
