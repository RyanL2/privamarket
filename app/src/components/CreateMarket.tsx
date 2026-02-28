"use client";

import { useState } from "react";
import { useCreateMarket } from "@/hooks/usePrivateMarket";

export default function CreateMarket() {
  const [question, setQuestion] = useState("");
  const [days, setDays] = useState("30");
  const { createMarket, isConfirming, isSuccess } = useCreateMarket();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    const resolutionTime = Math.floor(Date.now() / 1000) + parseInt(days) * 86400;
    createMarket(question, resolutionTime, 5);
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
      <h3 className="text-lg font-semibold text-white">Create Market</h3>

      <div>
        <label className="block text-xs text-white/40 mb-1">Question</label>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Will X happen by Y date?"
          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500"
        />
      </div>

      <div>
        <label className="block text-xs text-white/40 mb-1">Resolution in (days)</label>
        <input
          type="number"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          min="1"
          max="365"
          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500"
        />
      </div>

      <button
        type="submit"
        disabled={isConfirming || !question.trim()}
        className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 py-2.5 text-sm font-medium text-white transition"
      >
        {isConfirming ? "Creating..." : isSuccess ? "Created!" : "Create Market"}
      </button>
    </form>
  );
}
