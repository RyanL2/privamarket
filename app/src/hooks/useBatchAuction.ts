"use client";

import { useState, useEffect, useCallback } from "react";
import { useReadContract } from "wagmi";
import { PRIVATEMARKET_ABI } from "@/lib/contracts";
import { CONTRACTS } from "@/lib/config";
import { useClearBatch } from "./usePrivateMarket";

export function useBatchTimer(marketId: number, batchInterval: number, lastClearTime: number) {
  const [timeLeft, setTimeLeft] = useState(0);
  const [canClear, setCanClear] = useState(false);

  useEffect(() => {
    const update = () => {
      const now = Math.floor(Date.now() / 1000);
      const nextClear = lastClearTime + batchInterval;
      const remaining = nextClear - now;

      setTimeLeft(Math.max(0, remaining));
      setCanClear(remaining <= 0);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [batchInterval, lastClearTime]);

  return { timeLeft, canClear };
}

export function useBatchAuction(marketId: number) {
  const { data: currentBatchId } = useReadContract({
    address: CONTRACTS.PRIVATE_MARKET,
    abi: PRIVATEMARKET_ABI,
    functionName: "getCurrentBatchId",
    args: [BigInt(marketId)],
  });

  const { data: batchOrders } = useReadContract({
    address: CONTRACTS.PRIVATE_MARKET,
    abi: PRIVATEMARKET_ABI,
    functionName: "getBatchOrders",
    args: [BigInt(marketId), currentBatchId ?? 0n],
    query: { enabled: currentBatchId !== undefined },
  });

  const { clearBatch, isConfirming, isSuccess } = useClearBatch();

  const triggerClear = useCallback(() => {
    clearBatch(marketId);
  }, [clearBatch, marketId]);

  return {
    currentBatchId: currentBatchId ? Number(currentBatchId) : 0,
    orderCount: batchOrders?.length ?? 0,
    triggerClear,
    isClearing: isConfirming,
    clearSuccess: isSuccess,
  };
}
