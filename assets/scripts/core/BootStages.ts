/**
 * Ordered loading stages for the Boot screen (pure TS, no `cc`, unit-tested with plain Node).
 * Each stage runs after the previous one finishes, reports its own 0–1 progress, and the
 * runner stops at the first failure so Boot can show the error and offer a retry.
 */
import type { LevelConfig } from '../config/LevelConfig';

export type StageState = 'waiting' | 'loading' | 'done' | 'failed';

export interface StageContext {
    /** Progress inside the current stage, 0–1. */
    report(fraction: number): void;
}

export interface BootStage {
    title: string;
    /** Resolves with a short detail text shown next to the stage, e.g. "levels.json v1 OK". */
    run(ctx: StageContext): Promise<string | void>;
}

export interface StageStatus {
    title: string;
    state: StageState;
    detail: string;
}

export interface BootSnapshot {
    stages: StageStatus[];
    /** Index of the running (or failed) stage; stages.length once all are done. */
    current: number;
    /** Overall progress, 0–1. */
    progress: number;
}

export interface RunOptions {
    /** Minimum time each stage stays on screen so players can read it. */
    minStageMs?: number;
    now?: () => number;
    delay?: (ms: number) => Promise<void>;
}

export interface RunResult {
    ok: boolean;
    failedIndex?: number;
    error?: unknown;
}

export const STAGE_MARK: Record<StageState, string> = {
    waiting: '○',
    loading: '✱',
    done: '✓',
    failed: '✗',
};

const defaultDelay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export async function runStages(
    stages: readonly BootStage[],
    onChange: (snap: BootSnapshot) => void,
    opt: RunOptions = {},
): Promise<RunResult> {
    const minMs = opt.minStageMs ?? 0;
    const now = opt.now ?? (() => Date.now());
    const delay = opt.delay ?? defaultDelay;
    const status: StageStatus[] = stages.map((s) => ({ title: s.title, state: 'waiting', detail: '' }));
    const n = stages.length;
    let current = 0;
    let fraction = 0;

    const emit = (): void => {
        const progress = n === 0 ? 1 : Math.min(1, (current + fraction) / n);
        onChange({ stages: status.map((s) => ({ ...s })), current, progress });
    };

    for (current = 0; current < n; current++) {
        fraction = 0;
        status[current].state = 'loading';
        emit();
        const started = now();
        try {
            const detail = await stages[current].run({
                report: (f) => {
                    const next = Math.min(1, Math.max(0, f));
                    if (next <= fraction) return;
                    fraction = next;
                    emit();
                },
            });
            const left = minMs - (now() - started);
            if (left > 0) await delay(left);
            status[current].state = 'done';
            status[current].detail = detail ?? '';
            fraction = 0;
        } catch (error) {
            status[current].state = 'failed';
            status[current].detail = errorText(error);
            emit();
            return { ok: false, failedIndex: current, error };
        }
    }
    emit();
    return { ok: true };
}

/**
 * Weather / event sanity check for the 天氣系統 stage. LevelConfig already validates the
 * schema; this checks the combinations the weather system relies on and summarizes them.
 */
export function describeWeather(cfg: LevelConfig): string {
    const issues: string[] = [];
    for (const kind of ['wind', 'rain', 'eagle'] as const) {
        const ev = cfg.events?.[kind];
        if (!ev) {
            issues.push(`events.${kind} missing`);
            continue;
        }
        const [lo, hi] = ev.durationSec;
        if (hi >= ev.everySec) issues.push(`events.${kind}: duration ${hi}s must be shorter than everySec ${ev.everySec}s`);
        if (lo > hi) issues.push(`events.${kind}: durationSec reversed`);
    }
    const chances = cfg.levels.map((l) => l.windChance);
    if (chances.some((c) => !(c >= 0 && c <= 1))) issues.push('levels[].windChance must be 0–1');
    if (issues.length) throw new Error(`天氣參數錯誤：${issues.join('；')}`);
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    return `風／雨／鷹 OK，強風 ${pct(Math.min(...chances))}–${pct(Math.max(...chances))}`;
}
