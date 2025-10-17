import React from 'react';

const Info: React.FC<{title: string; children: React.ReactNode;}> = ({ title, children }) => (
  <div className="text-xs text-[var(--text-secondary)]">
    <span className="inline-flex items-center gap-1">
      <i className="fa-regular fa-circle-question text-[var(--accent-purple)]"></i>
      <span className="font-semibold text-[var(--text-primary)]">{title}</span>
    </span>
    <div className="mt-1 ml-5">{children}</div>
  </div>
);

const number = (v: string, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const percent = (v: string, fallback: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 0), 1);
};

const ParamField: React.FC<{ label: string; value: string | number; suffix?: string; onChange: (v: string) => void; }> = ({ label, value, suffix, onChange }) => (
  <label className="flex items-center justify-between gap-3 py-1.5">
    <span className="w-1/2 text-sm text-[var(--text-secondary)]">{label}</span>
    <div className="flex items-center gap-2 w-1/2">
      <input
        className="flex-1 px-2 py-1 bg-[var(--background-secondary)] rounded border border-[var(--separator-primary)] text-[var(--text-primary)]"
        value={String(value)}
        onChange={e => onChange(e.target.value)}
      />
      {suffix && <span className="text-xs text-[var(--text-secondary)]">{suffix}</span>}
    </div>
  </label>
);

interface SolverParams {
  MIN_CHUNK_MINUTES: number;
  TARGET_CHUNK_MINUTES: number;
  DAILY_CAP_MINUTES: number;
  MAX_TASKS_PER_DAY: number;
  TIER1_WEEKLY_SHARE: number; // 0-1
  PHYSICS_WEEKLY_SHARE: number; // 0-1
  QB_NIS_WEEKLY_CEIL: number; // 0-1
  W_LATE_TIER1: number;
  W_LATE_PHYS: number;
  W_UNSCHED: number;
  W_FRAG: number;
  W_LONGTASK: number;
  W_TIER2_EARLY: number;
  W_TIER1_DEFICIT: number;
  W_PHYS_DEFICIT: number;
  W_QBN_EXCESS: number;
  ORTOOLS_WORKERS: number;
  ORTOOLS_MAX_TIME: number; // seconds
}

interface Props {
  params: SolverParams;
  onChange: (p: Partial<SolverParams>) => void;
  onApply: () => void;
}

const ParametersPanel: React.FC<Props> = ({ params, onChange, onApply }) => {
  return (
    <div className="space-y-4">
      <h3 className="mb-4 text-base font-semibold text-[var(--text-primary)]">OR‑Tools Parameters</h3>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <ParamField label="Min chunk (minutes)" value={params.MIN_CHUNK_MINUTES} onChange={v => onChange({ MIN_CHUNK_MINUTES: number(v, params.MIN_CHUNK_MINUTES) })} />
          <Info title="What it does">Ensures small items are bundled so no task is shorter than this value. Example: set 15 to eliminate 0–3 minute Core fragments; 30 makes every task at least half a Pomodoro.</Info>
          <ParamField label="Target chunk (minutes)" value={params.TARGET_CHUNK_MINUTES} onChange={v => onChange({ TARGET_CHUNK_MINUTES: number(v, params.TARGET_CHUNK_MINUTES) })} />
          <Info title="What it does">Preferred size for splitting long videos/chapters. Higher values produce fewer, longer blocks. Example: 30 → 3×30 rather than 6×15 for a 90‑minute video.</Info>
          <ParamField label="Daily cap (minutes)" value={params.DAILY_CAP_MINUTES} onChange={v => onChange({ DAILY_CAP_MINUTES: number(v, params.DAILY_CAP_MINUTES) })} />
          <Info title="What it does">Maximum daily planned study minutes. Set 840 for 14 hours; lowering to 720 creates natural buffer for overruns.</Info>
          <ParamField label="Max tasks per day" value={params.MAX_TASKS_PER_DAY} onChange={v => onChange({ MAX_TASKS_PER_DAY: number(v, params.MAX_TASKS_PER_DAY) })} />
          <Info title="What it does">Caps number of scheduled items/day to reduce fragmentation. Example: 18 keeps days from filling with many tiny tasks.</Info>
          <ParamField label="Tier‑1 weekly share" value={params.TIER1_WEEKLY_SHARE} onChange={v => onChange({ TIER1_WEEKLY_SHARE: number(v, params.TIER1_WEEKLY_SHARE) })} />
          <Info title="What it does">Minimum weekly fraction devoted to primary content (Titan/CTC/Case Companion/Physics). Example: 0.6 forces ≥60% weekly time for Tier‑1 until first‑pass completion.</Info>
          <ParamField label="Physics weekly share" value={params.PHYSICS_WEEKLY_SHARE} onChange={v => onChange({ PHYSICS_WEEKLY_SHARE: number(v, params.PHYSICS_WEEKLY_SHARE) })} />
          <Info title="What it does">Ensures baseline of physics per week. Example: 0.2 ≈ 1 day/week of physics content.</Info>
          <ParamField label="QB/NIS weekly ceiling" value={params.QB_NIS_WEEKLY_CEIL} onChange={v => onChange({ QB_NIS_WEEKLY_CEIL: number(v, params.QB_NIS_WEEKLY_CEIL) })} />
          <Info title="What it does">Caps questions and NIS early to avoid crowding out primaries. Example: 0.2 ≈ 1.5–2 hours/day until Tier‑1 catches up.</Info>
        </div>
        <div className="space-y-2">
          <ParamField label="W late (Tier‑1)" value={params.W_LATE_TIER1} onChange={v => onChange({ W_LATE_TIER1: number(v, params.W_LATE_TIER1) })} />
          <Info title="What it does">Penalty per day that a topic’s last primary task finishes after the first‑pass deadline. Larger values push primaries earlier.</Info>
          <ParamField label="W late (Physics)" value={params.W_LATE_PHYS} onChange={v => onChange({ W_LATE_PHYS: number(v, params.W_LATE_PHYS) })} />
          <Info title="What it does">Softer lateness penalty for physics topics. Increase if physics lags too much behind primaries.</Info>
          <ParamField label="W unscheduled" value={params.W_UNSCHED} onChange={v => onChange({ W_UNSCHED: number(v, params.W_UNSCHED) })} />
          <Info title="What it does">Cost per unscheduled minute. Larger values reduce backlog but may increase day utilization or push more bundling.</Info>
          <ParamField label="W fragmentation" value={params.W_FRAG} onChange={v => onChange({ W_FRAG: number(v, params.W_FRAG) })} />
          <Info title="What it does">Penalizes tasks/day. Raising this clusters longer blocks together and prunes tiny inserts.</Info>
          <ParamField label="Reward long tasks" value={params.W_LONGTASK} onChange={v => onChange({ W_LONGTASK: number(v, params.W_LONGTASK) })} />
          <Info title="What it does">Small reward per scheduled minute to prefer fewer, longer segments. Increase slightly if the plan still looks choppy.</Info>
          <ParamField label="W Tier 2 early penalty" value={params.W_TIER2_EARLY} onChange={v => onChange({ W_TIER2_EARLY: number(v, params.W_TIER2_EARLY) })} />
          <Info title="What it does">Penalty for scheduling Tier-2 QBank/NIS before all Tier-1 primaries complete. Raises cost for early questions to delay them behind readings/videos.</Info>
          <ParamField label="W Tier 1 quota deficit" value={params.W_TIER1_DEFICIT} onChange={v => onChange({ W_TIER1_DEFICIT: number(v, params.W_TIER1_DEFICIT) })} />
          <Info title="What it does">Penalty per minute shortfall for Tier-1 weekly study share. Helps front-load primary material over optional.</Info>
          <ParamField label="W Physics quota deficit" value={params.W_PHYS_DEFICIT} onChange={v => onChange({ W_PHYS_DEFICIT: number(v, params.W_PHYS_DEFICIT) })} />
          <Info title="What it does">Penalty per minute shortfall for physics weekly study share.</Info>
          <ParamField label="W QBN excess penalty" value={params.W_QBN_EXCESS} onChange={v => onChange({ W_QBN_EXCESS: number(v, params.W_QBN_EXCESS) })} />
          <Info title="What it does">Penalty per minute excess for QB/NIS weekly ceiling. Helps keep question bank minutes limited early.</Info>
          <ParamField label="Workers" value={params.ORTOOLS_WORKERS} onChange={v => onChange({ ORTOOLS_WORKERS: number(v, params.ORTOOLS_WORKERS) })} />
          <Info title="What it does">Max parallel workers for CP‑SAT. Set to 8 on your upgraded plan; try 4–6 if search is noisy.</Info>
          <ParamField label="Max solve time (s)" value={params.ORTOOLS_MAX_TIME} onChange={v => onChange({ ORTOOLS_MAX_TIME: number(v, params.ORTOOLS_MAX_TIME) })} />
          <Info title="What it does">Max seconds for CP-SAT solver. Use 180 for generation, 60-90 for quick rebalances.</Info>
        </div>
      </div>
      <div className="pt-3 border-t border-[var(--separator-primary)] flex justify-end">
        <button onClick={onApply} className="px-3 py-1.5 rounded bg-[var(--accent-purple)] text-white font-semibold hover:brightness-110">
          Apply & Regenerate with OR-Tools
        </button>
      </div>
    </div>
  );
};

export default ParametersPanel;
