"use client";

import { useCallback, useEffect, useRef } from "react";
import { useBatchTimer, useBatchAuction } from "@/hooks/useBatchAuction";

interface BatchTimerProps {
  marketId: number;
  batchInterval: number;
  lastClearTime: number;
  onBatchCleared?: () => void;
}

export default function BatchTimer({ marketId, batchInterval, lastClearTime, onBatchCleared }: BatchTimerProps) {
  const { timeLeft, canClear } = useBatchTimer(marketId, batchInterval, lastClearTime);
  const {
    currentBatchId,
    orderCount,
    hasBothSides,
    hasExecutableOrders,
    triggerClear,
    clearHash,
    isClearing,
    clearSuccess,
    clearError,
    autoClear,
    setAutoClear,
    autoClearFiredRef,
  } = useBatchAuction(marketId);
  const handledSuccessHashRef = useRef<`0x${string}` | undefined>(undefined);
  const rawClearErrorMessage =
    (clearError as { shortMessage?: string } | null)?.shortMessage ?? clearError?.message ?? null;
  const clearErrorMessage =
    clearSuccess || !rawClearErrorMessage
      ? null
      : rawClearErrorMessage.toLowerCase().includes("internal error")
        ? "RPC simulation failed. Retry in a few seconds."
        : rawClearErrorMessage;
  const handleClear = useCallback(() => {
    if (!canClear || !hasExecutableOrders || isClearing || autoClearFiredRef.current) return;
    autoClearFiredRef.current = true;
    triggerClear();
  }, [autoClearFiredRef, canClear, hasExecutableOrders, isClearing, triggerClear]);

  // Auto-clear when timer expires and there are orders
  useEffect(() => {
    if (autoClear && canClear && hasExecutableOrders && !isClearing && !autoClearFiredRef.current) {
      handleClear();
    }
  }, [autoClear, canClear, hasExecutableOrders, isClearing, handleClear, autoClearFiredRef]);

  useEffect(() => {
    if (clearSuccess && clearHash && handledSuccessHashRef.current !== clearHash) {
      handledSuccessHashRef.current = clearHash;
      onBatchCleared?.();
    }
  }, [clearSuccess, clearHash, onBatchCleared]);

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
        onClick={handleClear}
        disabled={!canClear || isClearing || !hasExecutableOrders}
        className={`w-full rounded-lg py-2.5 text-sm font-medium transition ${
          canClear && hasExecutableOrders
            ? "bg-emerald-600 hover:bg-emerald-500 text-white"
            : "bg-white/5 text-white/30 cursor-not-allowed"
        }`}
      >
        {isClearing ? "Clearing..." : canClear ? (hasExecutableOrders ? "Clear Batch" : "No Match Yet") : "Waiting..."}
      </button>

      {clearSuccess && !isClearing && (
        <p className="mt-2 text-xs text-emerald-400/80">
          Batch cleared. Refreshing market data...
        </p>
      )}
      {clearErrorMessage && !isClearing && (
        <p className="mt-2 text-xs text-red-400/80">
          Clear failed: {clearErrorMessage}
        </p>
      )}
      {hasBothSides && !hasExecutableOrders && orderCount > 0 && !isClearing && (
        <p className="mt-2 text-xs text-amber-400/80">
          Need crossing YES/NO prices to clear this batch.
        </p>
      )}
      {!hasBothSides && orderCount > 0 && !isClearing && (
        <p className="mt-2 text-xs text-white/40">
          Add both YES and NO orders to enable matching.
        </p>
      )}

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
