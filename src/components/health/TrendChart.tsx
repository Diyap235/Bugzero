"use client";

import React, { useState } from "react";
import { Card, CardHeader, CardTitle } from "../shared/Card";

interface TrendPoint {
  date: string;
  score: number;
}

interface TrendChartProps {
  data: TrendPoint[];
}

export const TrendChart: React.FC<TrendChartProps> = ({ data }) => {
  const [period, setPeriod] = useState("30 Days");

  const maxScore = 100;
  const height = 180;
  const width = 600;

  const points = data
    .map((pt, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - (pt.score / maxScore) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <Card className="space-y-4">
      <CardHeader>
        <CardTitle className="text-base">Repository Quality & Health Trend</CardTitle>
        <div className="flex items-center gap-1 bg-surface p-1 border border-border rounded-lg text-xs font-medium">
          {["7 Days", "30 Days", "90 Days", "All Time"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded transition-colors ${
                period === p ? "bg-primary text-white font-semibold" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </CardHeader>

      {/* SVG Trend Line */}
      <div className="w-full overflow-hidden pt-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 overflow-visible">
          {/* Grid lines */}
          <line x1="0" y1="0" x2={width} y2="0" stroke="#1E3025" strokeDasharray="4" />
          <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#1E3025" strokeDasharray="4" />
          <line x1="0" y1={height} x2={width} y2={height} stroke="#1E3025" />

          {/* Polyline */}
          <polyline
            fill="none"
            stroke="#2E7D32"
            strokeWidth="3"
            points={points}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Dots */}
          {data.map((pt, idx) => {
            const x = (idx / (data.length - 1)) * width;
            const y = height - (pt.score / maxScore) * height;
            return (
              <g key={idx}>
                <circle cx={x} cy={y} r="5" fill="#4CAF50" stroke="#050705" strokeWidth="2" />
                <text x={x} y={y - 12} fill="#AAB5AF" fontSize="10" textAnchor="middle" fontFamily="JetBrains Mono">
                  {pt.score}%
                </text>
              </g>
            );
          })}
        </svg>

        {/* Date Labels */}
        <div className="flex justify-between text-xs text-text-muted font-mono pt-2 border-t border-border">
          {data.map((pt, idx) => (
            <span key={idx}>{pt.date}</span>
          ))}
        </div>
      </div>
    </Card>
  );
};
