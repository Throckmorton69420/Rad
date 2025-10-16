import React from 'react';

export interface SolverParams {
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
  ORTOOLS_WORKERS: number;
  ORTOOLS_MAX_TIME: number; // seconds
}

const Info: React.FC<{title: string; children: React.ReactNode;}> = ({ title, children }) => (
  <div className="text-xs text-[var(--text-secondary)]">
    <span className="inline-flex items-center gap-1">
      <i className="fa-regular fa-circle-question text-[var(--accent-purple)]"></i>
      <span className="font-semibold text-[var(--text-primary)]">{title}</span>
    </span>
    <div className="mt-1 ml-5">{children}</div>
  </div>
);

interface Props {
  params: SolverParams;
  onChange: (p: Partial<SolverParams>) => void;
  onApply: () => void;
}

const number = (v: string, fallback: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

const percent = (v: string, fallback: number) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(0, Math.min(1, x));
};

const ParamField: React.FC<{
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  suffix?: string;
}> = ({ label, value, onChange, suffix }) => (
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

const ParametersPanel: React.FC<Props> = ({ params, onChange, onApply }) => {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-[var(--text-primary)]">OR‑Tools Parameters</h3>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <ParamField label="Min chunk (minutes)" value={params.MIN_CHUNK_MINUTES}
            onChange={v => onChange({ MIN_CHUNK_MINUTES: number(v, params.MIN_CHUNK_MINUTES) })} />
          <Info title="What it does">
            Ensures small items are bundled so no task is shorter than this value. Example: set 15 to eliminate 0–3 minute Core fragments; 30 makes every task at least half a Pomodoro. 
          </Info>

          <ParamField label="Target chunk (minutes)" value={params.TARGET_CHUNK_MINUTES}
            onChange={v => onChange({ TARGET_CHUNK_MINUTES: number(v, params.TARGET_CHUNK_MINUTES) })} />
          <Info title="What it does">
            Preferred size when splitting long videos/chapters. Higher values produce fewer, longer blocks. Example: 30 → 3×30 rather than 6×15 for a 90‑minute video.
          </Info>

          <ParamField label="Daily cap (minutes)" value={params.DAILY_CAP_MINUTES}
            onChange={v => onChange({ DAILY_CAP_MINUTES: number(v, params.DAILY_CAP_MINUTES) })} />
          <Info title="What it does">
            Maximum planned study minutes per day. Set 840 for 14 hours; lowering to 720 creates natural buffer for over‑runs.
          </Info>

          <ParamField label="Max tasks per day" value={params.MAX_TASKS_PER_DAY}
            onChange={v => onChange({ MAX_TASKS_PER_DAY: number(v, params.MAX_TASKS_PER_DAY) })} />
          <Info title="What it does">
            Caps the number of items scheduled per day to reduce fragmentation. Example: 18 keeps days from filling with many tiny tasks.
          </Info>
        </div>

        <div className="space-y-2">
          <ParamField label="Tier‑1 weekly share" value={params.TIER1_WEEKLY_SHARE}
            onChange={v => onChange({ TIER1_WEEKLY_SHARE: percent(v, params.TIER1_WEEKLY_SHARE) })} />
          <Info title="What it does">
            Minimum fraction of each week devoted to primary content (Titan/CTC/Case Companion/Physics). Example: 0.6 forces ≥60% of weekly time for Tier‑1 until first‑pass is done.
          </Info>

          <ParamField label="Physics weekly share" value={params.PHYSICS_WEEKLY_SHARE}
            onChange={v => onChange({ PHYSICS_WEEKLY_SHARE: percent(v, params.PHYSICS_WEEKLY_SHARE) })} />
          <Info title="What it does">
            Ensures a baseline of physics per week. Example: 0.2 → about 1 day per week of physics content.
          </Info>

          <ParamField label="QB/NIS weekly ceiling" value={params.QB_NIS_WEEKLY_CEIL}
            onChange={v => onChange({ QB_NIS_WEEKLY_CEIL: percent(v, params.QB_NIS_WEEKLY_CEIL) })} />
          <Info title="What it does">
            Caps questions and NIS early so they don’t crowd out primaries. Example: 0.2 restricts to ~1.5–2 hours/day equivalent until Tier‑1 catches up.
          </Info>

          <ParamField label="W late (Tier‑1)" value={params.W_LATE_TIER1}
            onChange={v => onChange({ W_LATE_TIER1: number(v, params.W_LATE_TIER1) })} />
          <Info title="What it does">
            Penalty per day that a topic’s last primary task finishes after the first‑pass deadline. Larger values push primaries earlier.
          </Info>

          <ParamField label="W late (Physics)" value={params.W_LATE_PHYS}
            onChange={v => onChange({ W_LATE_PHYS: number(v, params.W_LATE_PHYS) })} />
          <Info title="What it does">
            Softer lateness penalty for physics topics. Increase if physics lags too much behind primaries.
          </Info>

          <ParamField label="W unscheduled" value={params.W_UNSCHED}
            onChange={v => onChange({ W_UNSCHED: number(v, params.W_UNSCHED) })} />
          <Info title="What it does">
            Cost per unscheduled minute. Larger values reduce backlog but may increase day utilization or push more bundling.
          </Info>

          <ParamField label="W fragmentation" value={params.W_FRAG}
            onChange={v => onChange({ W_FRAG: number(v, params.W_FRAG) })} />
          <Info title="What it does">
            Penalizes tasks/day. Raising this clusters longer blocks together and prunes tiny inserts.
          </Info>

          <ParamField label="Reward long tasks" value={params.W_LONGTASK}
            onChange={v => onChange({ W_LONGTASK: number(v, params.W_LONGTASK) })} />
          <Info title="What it does">
            Small reward per scheduled minute to prefer fewer, longer segments. Increase slightly if the plan still looks choppy.
          </Info>

          <ParamField label="Workers" value={params.ORTOOLS_WORKERS}
            onChange={v => onChange({ ORTOOLS_WORKERS: number(v, params.ORTOOLS_WORKERS) })} />
          <Info title="What it does">
            Max parallel workers for CP‑SAT. Set to 8 on your upgraded plan; try 4–6 if search seems noisy.
          </Info>

          <ParamField label="Max solve time (s)" value={params.ORTOOLS_MAX_TIME}
            onChange={v => onChange({ ORTOOLS_MAX_TIME: number(v, params.ORTOOLS_MAX_TIME) })} />
          <Info title="What it does">
            Upper bound on solve time for generation/rebalance. Use 180 for generation and 60–90 for rebalances.
          </Info>
        </div>
      </div>

      <div className="pt-3 border-t border-[var(--separator-primary)] flex justify-end">
        <button onClick={onApply} className="px-3 py-1.5 rounded bg-[var(--accent-purple)] text-white font-semibold hover:brightness-110">
          Apply & Regenerate with OR‑Tools
        </button>
      </div>
    </div>
  );
};

export default ParametersPanel;
