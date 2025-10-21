import React from "react";

export function formatHMS(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hh = h > 0 ? `${h}:` : "";
  return `${hh}${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export const ReportProgress: React.FC<{
  percent: number;
  elapsedSeconds: number;
  etaSeconds: number | null;
  message?: string;
}> = ({ percent, elapsedSeconds, etaSeconds, message }) => {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="p-3 rounded-lg bg-black/20 border border-white/10">
      <div className="flex justify-between text-sm mb-1">
        <span>{message ?? "Working…"}</span>
        <span>{pct}%</span>
      </div>
      <div className="w-full h-2 bg-white/10 rounded">
        <div
          className="h-2 bg-[var(--accent-purple)] rounded"
          style={{ width: `${pct}%`, transition: "width 120ms linear" }}
        />
      </div>
      <div className="flex justify-between text-xs mt-2 opacity-80">
        <span>Elapsed: {formatHMS(elapsedSeconds)}</span>
        <span>Remaining: {etaSeconds == null ? "—" : formatHMS(etaSeconds)}</span>
      </div>
    </div>
  );
};
