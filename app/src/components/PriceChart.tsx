"use client";

import { useReadContracts } from "wagmi";
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

export default function PriceChart({ marketId, currentBatchId }: PriceChartProps) {
  const batchCount = Math.min(currentBatchId, 20);
  const startBatch = Math.max(0, currentBatchId - batchCount);

  const contracts = Array.from({ length: batchCount }, (_, i) => ({
    address: CONTRACTS.PRIVATE_MARKET,
    abi: PRIVATEMARKET_ABI,
    functionName: "getBatchResult" as const,
    args: [BigInt(marketId), BigInt(startBatch + i)] as const,
  }));

  const { data: results } = useReadContracts({ contracts });

  const points: { batchId: number; price: number; volume: number; timestamp: number }[] = [];

  if (results) {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "success" && r.result) {
        const batch = r.result as unknown as BatchResult;
        if (batch.timestamp > 0n && batch.clearingPrice > 0n) {
          points.push({
            batchId: startBatch + i,
            price: Number(batch.clearingPrice) / 100,
            volume: Number(batch.yesVolume) + Number(batch.noVolume),
            timestamp: Number(batch.timestamp),
          });
        }
      }
    }
  }

  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Price History</h3>
        <div className="h-40 flex items-center justify-center text-white/20 text-sm">
          No batch data yet. Place orders and clear batches to see price history.
        </div>
      </div>
    );
  }

  const W = 400;
  const H = 160;
  const PAD_X = 40;
  const PAD_Y = 20;
  const chartW = W - PAD_X * 2;
  const chartH = H - PAD_Y * 2;

  const prices = points.map((p) => p.price);
  const minPrice = Math.max(0, Math.min(...prices) - 5);
  const maxPrice = Math.min(100, Math.max(...prices) + 5);
  const priceRange = maxPrice - minPrice || 1;

  const toX = (i: number) => PAD_X + (i / Math.max(1, points.length - 1)) * chartW;
  const toY = (price: number) => PAD_Y + chartH - ((price - minPrice) / priceRange) * chartH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.price).toFixed(1)}`).join(" ");

  const areaPath = `${linePath} L${toX(points.length - 1).toFixed(1)},${(PAD_Y + chartH).toFixed(1)} L${PAD_X.toFixed(1)},${(PAD_Y + chartH).toFixed(1)} Z`;

  const gridLines = [0, 25, 50, 75, 100].filter((v) => v >= minPrice && v <= maxPrice);

  const lastPrice = points[points.length - 1].price;
  const firstPrice = points[0].price;
  const priceChange = lastPrice - firstPrice;
  const isPositive = priceChange >= 0;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Price History</h3>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold font-mono text-white">{lastPrice.toFixed(1)}%</span>
          <span className={`text-xs font-mono ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
            {isPositive ? "+" : ""}{priceChange.toFixed(1)}%
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isPositive ? "#34d399" : "#f87171"} stopOpacity="0.3" />
            <stop offset="100%" stopColor={isPositive ? "#34d399" : "#f87171"} stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridLines.map((v) => (
          <g key={v}>
            <line
              x1={PAD_X}
              y1={toY(v)}
              x2={W - PAD_X}
              y2={toY(v)}
              stroke="white"
              strokeOpacity="0.06"
              strokeDasharray="4 4"
            />
            <text x={PAD_X - 4} y={toY(v) + 3} textAnchor="end" fill="white" fillOpacity="0.25" fontSize="9" fontFamily="monospace">
              {v}%
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#priceGrad)" />

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
            key={i}
            cx={toX(i)}
            cy={toY(p.price)}
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
        <span>YES probability over time</span>
      </div>
    </div>
  );
}
