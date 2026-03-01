"use client";

import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { PRIVATEMARKET_ABI, WMON_ABI } from "@/lib/contracts";
import { CONTRACTS, isConfiguredAddress } from "@/lib/config";
import { parseEther } from "viem";

export interface MarketData {
  id: number;
  question: string;
  resolutionTime: bigint;
  yesToken: `0x${string}`;
  noToken: `0x${string}`;
  creator: `0x${string}`;
  resolved: number;
  currentBatchId: bigint;
  batchInterval: bigint;
  lastClearTime: bigint;
  collateralPool: bigint;
}

export function useMarketCount() {
  return useReadContract({
    address: CONTRACTS.PRIVATE_MARKET,
    abi: PRIVATEMARKET_ABI,
    functionName: "nextMarketId",
  });
}

export function useMarket(marketId: number) {
  const { data, ...rest } = useReadContract({
    address: CONTRACTS.PRIVATE_MARKET,
    abi: PRIVATEMARKET_ABI,
    functionName: "getMarket",
    args: [BigInt(marketId)],
  });

  const market: MarketData | undefined = data
    ? {
        id: marketId,
        question: data[0],
        resolutionTime: data[1],
        yesToken: data[2],
        noToken: data[3],
        creator: data[4],
        resolved: data[5],
        currentBatchId: data[6],
        batchInterval: data[7],
        lastClearTime: data[8],
        collateralPool: data[9],
      }
    : undefined;

  return { data: market, ...rest };
}

export function useMarkets(count: number) {
  const contracts = Array.from({ length: count }, (_, i) => ({
    address: CONTRACTS.PRIVATE_MARKET,
    abi: PRIVATEMARKET_ABI,
    functionName: "getMarket" as const,
    args: [BigInt(i)] as const,
  }));

  const { data, ...rest } = useReadContracts({ contracts });

  const markets: MarketData[] = (data ?? [])
    .map((result, i) => {
      if (result.status !== "success" || !result.result) return null;
      const d = result.result as [string, bigint, `0x${string}`, `0x${string}`, `0x${string}`, number, bigint, bigint, bigint, bigint];
      return {
        id: i,
        question: d[0],
        resolutionTime: d[1],
        yesToken: d[2],
        noToken: d[3],
        creator: d[4],
        resolved: d[5],
        currentBatchId: d[6],
        batchInterval: d[7],
        lastClearTime: d[8],
        collateralPool: d[9],
      };
    })
    .filter((m): m is MarketData => m !== null);

  return { data: markets, ...rest };
}

export function useBatchResult(marketId: number, batchId: number) {
  return useReadContract({
    address: CONTRACTS.PRIVATE_MARKET,
    abi: PRIVATEMARKET_ABI,
    functionName: "getBatchResult",
    args: [BigInt(marketId), BigInt(batchId)],
  });
}

export function usePlaceOrder() {
  const { writeContract, data: hash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const placeOrder = (marketId: number, side: 0 | 1, price: number, amount: string) => {
    writeContract({
      address: CONTRACTS.PRIVATE_MARKET,
      abi: PRIVATEMARKET_ABI,
      functionName: "placeOrder",
      args: [BigInt(marketId), side, BigInt(price), parseEther(amount)],
    });
  };

  return { placeOrder, hash, isConfirming, isSuccess };
}

export function useClearBatch() {
  const { writeContract, data: hash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const clearBatch = (marketId: number) => {
    writeContract({
      address: CONTRACTS.PRIVATE_MARKET,
      abi: PRIVATEMARKET_ABI,
      functionName: "clearBatch",
      args: [BigInt(marketId)],
    });
  };

  return { clearBatch, hash, isConfirming, isSuccess };
}

export function useCreateMarket() {
  const { writeContract, data: hash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const createMarket = (question: string, resolutionTime: number, batchInterval: number = 5) => {
    writeContract({
      address: CONTRACTS.PRIVATE_MARKET,
      abi: PRIVATEMARKET_ABI,
      functionName: "createMarket",
      args: [question, BigInt(resolutionTime), BigInt(batchInterval)],
    });
  };

  return { createMarket, hash, isConfirming, isSuccess };
}

export function useWMonBalance(address?: `0x${string}`) {
  return useReadContract({
    address: CONTRACTS.WMON,
    abi: WMON_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && isConfiguredAddress(CONTRACTS.WMON) },
  });
}
