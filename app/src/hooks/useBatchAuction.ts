"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useReadContract } from "wagmi";
import { PRIVATEMARKET_ABI } from "@/lib/contracts";
import { CONTRACTS } from "@/lib/config";
import { useClearBatch } from "./usePrivateMarket";

interface BatchOrder {
  side: number | bigint;
  price: bigint;
  amount: bigint;
  filled: boolean;
}

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
  const { data: currentBatchId, refetch: refetchBatchId } = useReadContract({
    address: CONTRACTS.PRIVATE_MARKET,
    abi: PRIVATEMARKET_ABI,
    functionName: "getCurrentBatchId",
    args: [BigInt(marketId)],
    query: {
      refetchInterval: 3000,
      refetchOnWindowFocus: true,
    },
  });

  const { data: batchOrders, refetch: refetchOrders } = useReadContract({
    address: CONTRACTS.PRIVATE_MARKET,
    abi: PRIVATEMARKET_ABI,
    functionName: "getBatchOrders",
    args: [BigInt(marketId), currentBatchId ?? 0n],
    query: {
      enabled: currentBatchId !== undefined,
      refetchInterval: 3000,
      refetchOnWindowFocus: true,
    },
  });

  const { clearBatch, hash: clearHash, isSubmitting, isConfirming, isSuccess, clearError } = useClearBatch();
  const [autoClear, setAutoClear] = useState(true);
  const autoClearFiredRef = useRef(false);
  const handledClearHashRef = useRef<`0x${string}` | undefined>(undefined);
  const orders = (batchOrders ?? []) as readonly BatchOrder[];
  const activeOrders = orders.filter((order) => !order.filled && order.amount > 0n);
  const yesOrders = activeOrders.filter((order) => Number(order.side) === 0);
  const noOrders = activeOrders.filter((order) => Number(order.side) === 1);
  const hasBothSides = yesOrders.length > 0 && noOrders.length > 0;
  const maxYesPrice = yesOrders.reduce((max, order) => (order.price > max ? order.price : max), 0n);
  const maxNoPrice = noOrders.reduce((max, order) => (order.price > max ? order.price : max), 0n);
  const hasExecutableOrders = hasBothSides && maxYesPrice + maxNoPrice >= 10000n;

  const triggerClear = useCallback(() => {
    clearBatch(marketId);
  }, [clearBatch, marketId]);

  useEffect(() => {
    autoClearFiredRef.current = false;
  }, [currentBatchId]);

  useEffect(() => {
    if (clearError) {
      autoClearFiredRef.current = false;
    }
  }, [clearError]);

  useEffect(() => {
    const handleOrderSubmitted = () => {
      autoClearFiredRef.current = false;
      void refetchBatchId();
      void refetchOrders();
    };

    window.addEventListener("privamarket:order-submitted", handleOrderSubmitted);
    return () => window.removeEventListener("privamarket:order-submitted", handleOrderSubmitted);
  }, [refetchBatchId, refetchOrders]);

  // Refetch data after successful clear
  useEffect(() => {
    if (isSuccess && clearHash && handledClearHashRef.current !== clearHash) {
      handledClearHashRef.current = clearHash;
      refetchBatchId();
      refetchOrders();
    }
  }, [isSuccess, clearHash, refetchBatchId, refetchOrders]);

  return {
    currentBatchId: currentBatchId ? Number(currentBatchId) : 0,
    orderCount: activeOrders.length,
    hasBothSides,
    hasExecutableOrders,
    triggerClear,
    clearHash,
    isClearing: isSubmitting || isConfirming,
    clearSuccess: isSuccess,
    clearError,
    autoClear,
    setAutoClear,
    autoClearFiredRef,
  };
}
