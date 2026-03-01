"use client";

import { useEffect, useMemo, useState } from "react";
import { useReadContracts } from "wagmi";
import { formatEther } from "viem";
import { PRIVATEMARKET_ABI } from "@/lib/contracts";
import { CONTRACTS } from "@/lib/config";

interface PriceChartProps {
  marketId: number;
  currentBatchId: number;
}

interface BatchResult {
  clearingPrice: bigint;
  yesVolume: bigint;
  noVolume: bigint;
  timestamp: bigint;
}

interface ChartPoint {
  batchId: number;
  cumulativeVwapPrice: number;
  batchVolume: number;
  cumulativeVolume: number;
  timestamp: number;
}

export default function PriceChart({ marketId, currentBatchId }: PriceChartProps) {
  const batchCount = Math.min(currentBatchId, 12);
  const startBatch = Math.max(0, currentBatchId - batchCount);

  const contracts = Array.from({ length: batchCount }, (_, i) => ({
    address: CONTRACTS.PRIVATE_MARKET,
    abi: PRIVATEMARKET_ABI,
    functionName: "getBatchResult" as const,
    args: [BigInt(marketId), BigInt(startBatch + i)] as const,
  }));

  const { data: results } = useReadContracts({
    contracts,
    query: {
      enabled: contracts.length > 0,
      staleTime: 15000,
      refetchInterval: 15000,
      refetchOnWindowFocus: false,
    },
  });

  const computedPoints = useMemo<ChartPoint[]>(() => {
    const points: ChartPoint[] = [];
    let cumulativeVolumeWei = 0n;
    let cumulativeWeightedPrice = 0n;

    if (results) {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "success" && r.result) {
          const batch = r.result as unknown as BatchResult;
          const totalVolumeWei = batch.yesVolume + batch.noVolume;

          if (batch.timestamp > 0n && batch.clearingPrice > 0n && totalVolumeWei > 0n) {
            cumulativeVolumeWei += totalVolumeWei;
            cumulativeWeightedPrice += batch.clearingPrice * totalVolumeWei;
            const cumulativeVwapPriceBps = cumulativeWeightedPrice / cumulativeVolumeWei;

            points.push({
              batchId: startBatch + i,
              cumulativeVwapPrice: Number(cumulativeVwapPriceBps) / 100,
              batchVolume: Number(formatEther(totalVolumeWei)),
              cumulativeVolume: Number(formatEther(cumulativeVolumeWei)),
              timestamp: Number(batch.timestamp),
            });
          }
        }
      }
    }

    return points;
  }, [results, startBatch]);

  const [cachedPoints, setCachedPoints] = useState<ChartPoint[]>([]);

  useEffect(() => {
    if (computedPoints.length > 0) {
      setCachedPoints(computedPoints);
    }
  }, [computedPoints]);

  const points = computedPoints.length > 0 ? computedPoints : cachedPoints;

  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Cumulative Market Sentiment</h3>
        <div className="h-40 flex items-center justify-center text-white/20 text-sm">
          No matched batch data yet. Cumulative sentiment appears after priced batch clears.
        </div>
      </div>
    );
  }

  const W = 420;
  const H = 210;
  const PAD_X = 40;
  const PRICE_PAD_TOP = 16;
  const PRICE_CHART_H = 118;
  const VOLUME_TOP = 148;
  const VOLUME_H = 34;
  const chartW = W - PAD_X * 2;
  const priceBaseY = PRICE_PAD_TOP + PRICE_CHART_H;
  const volumeBaseY = VOLUME_TOP + VOLUME_H;

  const prices = points.map((p) => p.cumulativeVwapPrice);
  const minPrice = Math.max(0, Math.min(...prices) - 5);
  const maxPrice = Math.min(100, Math.max(...prices) + 5);
  const priceRange = maxPrice - minPrice || 1;
  const maxVolume = Math.max(...points.map((p) => p.batchVolume), 1);
  const barSlotWidth = chartW / Math.max(1, points.length);
  const barWidth = Math.max(4, Math.min(16, barSlotWidth * 0.6));

  const toX = (i: number) => PAD_X + (i / Math.max(1, points.length - 1)) * chartW;
  const toPriceY = (price: number) => PRICE_PAD_TOP + PRICE_CHART_H - ((price - minPrice) / priceRange) * PRICE_CHART_H;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toPriceY(p.cumulativeVwapPrice).toFixed(1)}`)
    .join(" ");

  const areaPath = `${linePath} L${toX(points.length - 1).toFixed(1)},${priceBaseY.toFixed(1)} L${PAD_X.toFixed(1)},${priceBaseY.toFixed(1)} Z`;

  const gridLines = [0, 25, 50, 75, 100].filter((v) => v >= minPrice && v <= maxPrice);

  const lastPrice = points[points.length - 1].cumulativeVwapPrice;
  const firstPrice = points[0].cumulativeVwapPrice;
  const priceChange = lastPrice - firstPrice;
  const isPositive = priceChange >= 0;
  const totalLiquidity = points[points.length - 1].cumulativeVolume;
  const latestBatchVolume = points[points.length - 1].batchVolume;
  const gradientId = `priceGrad-${marketId}`;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Cumulative Market Sentiment</h3>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold font-mono text-white">{lastPrice.toFixed(1)}% YES</span>
          <span className={`text-xs font-mono ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
            {isPositive ? "+" : ""}{priceChange.toFixed(1)}%
          </span>
        </div>
      </div>
      <p className="text-xs text-white/35 mb-3">
        Trendline uses cumulative VWAP across recent cleared batches; bars show per-batch liquidity.
      </p>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isPositive ? "#34d399" : "#f87171"} stopOpacity="0.3" />
            <stop offset="100%" stopColor={isPositive ? "#34d399" : "#f87171"} stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridLines.map((v) => (
          <g key={v}>
            <line
              x1={PAD_X}
              y1={toPriceY(v)}
              x2={W - PAD_X}
              y2={toPriceY(v)}
              stroke="white"
              strokeOpacity="0.06"
              strokeDasharray="4 4"
            />
            <text x={PAD_X - 4} y={toPriceY(v) + 3} textAnchor="end" fill="white" fillOpacity="0.25" fontSize="9" fontFamily="monospace">
              {v}%
            </text>
          </g>
        ))}

        <line
          x1={PAD_X}
          y1={VOLUME_TOP - 6}
          x2={W - PAD_X}
          y2={VOLUME_TOP - 6}
          stroke="white"
          strokeOpacity="0.08"
        />
        <text
          x={PAD_X - 4}
          y={VOLUME_TOP + 4}
          textAnchor="end"
          fill="white"
          fillOpacity="0.25"
          fontSize="8"
          fontFamily="monospace"
        >
          VOL
        </text>

        {points.map((p, i) => {
          const height = (p.batchVolume / maxVolume) * VOLUME_H;
          return (
            <rect
              key={`vol-${p.batchId}`}
              x={toX(i) - barWidth / 2}
              y={volumeBaseY - height}
              width={barWidth}
              height={Math.max(1, height)}
              rx={2}
              fill="#7c3aed"
              fillOpacity={0.65}
            />
          );
        })}

        <path d={areaPath} fill={`url(#${gradientId})`} />

        <path
          d={linePath}
          fill="none"
          stroke={isPositive ? "#34d399" : "#f87171"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p, i) => (
          <circle
            key={`dot-${p.batchId}`}
            cx={toX(i)}
            cy={toPriceY(p.cumulativeVwapPrice)}
            r="3"
            fill={isPositive ? "#34d399" : "#f87171"}
            stroke="#0a0a0f"
            strokeWidth="1.5"
          />
        ))}

        {points.length > 5
          ? [0, Math.floor(points.length / 2), points.length - 1].map((i) => (
              <text
                key={i}
                x={toX(i)}
                y={H - 4}
                textAnchor="middle"
                fill="white"
                fillOpacity="0.25"
                fontSize="8"
                fontFamily="monospace"
              >
                #{points[i].batchId}
              </text>
            ))
          : points.map((p, i) => (
              <text
                key={i}
                x={toX(i)}
                y={H - 4}
                textAnchor="middle"
                fill="white"
                fillOpacity="0.25"
                fontSize="8"
                fontFamily="monospace"
              >
                #{p.batchId}
              </text>
            ))}
      </svg>

      <div className="mt-2 flex items-center justify-between text-xs text-white/30">
        <span>{points.length} batches</span>
        <span>Total liquidity {totalLiquidity.toFixed(2)} MON</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-white/25">
        <span>Latest batch volume {latestBatchVolume.toFixed(2)} MON</span>
        <span>Cumulative VWAP trend</span>
      </div>
    </div>
  );
}
