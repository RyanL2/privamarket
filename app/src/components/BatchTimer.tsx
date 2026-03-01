"use client";

import { useEffect } from "react";
import { useBatchTimer, useBatchAuction } from "@/hooks/useBatchAuction";

interface BatchTimerProps {
  marketId: number;
  batchInterval: number;
  lastClearTime: number;
}

export default function BatchTimer({ marketId, batchInterval, lastClearTime }: BatchTimerProps) {
  const { timeLeft, canClear } = useBatchTimer(marketId, batchInterval, lastClearTime);
  const { currentBatchId, orderCount, triggerClear, isClearing, autoClear, setAutoClear, autoClearFiredRef } = useBatchAuction(marketId);

  // Auto-clear when timer expires and there are orders
  useEffect(() => {
    if (autoClear && canClear && orderCount > 0 && !isClearing && !autoClearFiredRef.current) {
      autoClearFiredRef.current = true;
      triggerClear();
    }
  }, [autoClear, canClear, orderCount, isClearing, triggerClear, autoClearFiredRef]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Batch Auction</h3>
        <span className="font-mono text-xs text-white/40">Batch #{currentBatchId}</span>
      </div>

      {/* Timer */}
      <div className="flex items-center justify-center py-4">
        <div className={`text-4xl font-mono font-bold ${canClear ? "text-emerald-400" : "text-white"}`}>
          {canClear ? "READY" : `${timeLeft}s`}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-3">
        <div
          className="h-full rounded-full bg-violet-500 transition-all duration-1000"
          style={{ width: `${Math.max(0, 100 - (timeLeft / batchInterval) * 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-white/40 mb-4">
        <span>{orderCount} orders in batch</span>
        <span>{batchInterval}s interval</span>
      </div>

      <button
        onClick={triggerClear}
        disabled={!canClear || isClearing}
        className={`w-full rounded-lg py-2.5 text-sm font-medium transition ${
          canClear
            ? "bg-emerald-600 hover:bg-emerald-500 text-white"
            : "bg-white/5 text-white/30 cursor-not-allowed"
        }`}
      >
        {isClearing ? "Clearing..." : canClear ? "Clear Batch" : "Waiting..."}
      </button>

      {/* Auto-clear toggle */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-white/40">Auto-clear when ready</span>
        <button
          onClick={() => setAutoClear(!autoClear)}
          className={`relative h-5 w-9 rounded-full transition ${autoClear ? "bg-emerald-600" : "bg-white/20"}`}
        >
          <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition ${autoClear ? "translate-x-4" : ""}`} />
        </button>
      </div>
    </div>
  );
}
