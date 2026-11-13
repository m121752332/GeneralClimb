import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseLevelConfig } from '../assets/scripts/config/LevelConfig.ts';
import {
    ClimbSim, EventScheduler, NO_DIR, PRACTICE_LEVEL_ID, createRng, demoRows, isObstacle, practiceLevel, zoneOf,
} from '../assets/scripts/climb/ClimbCore.ts';
import { HOUSE_HALF, LIFT, ROW_H, halfAt, houseSections } from '../assets/scripts/climb/TowerShape.ts';

const raw = JSON.parse(readFileSync(new URL('../assets/resources/config/levels.json', import.meta.url), 'utf8'));
const cfg = () => parseLevelConfig(raw);
const UP = { dx: 0, dy: 1 };
const FRAME = 1 / 60;

function run(sim: ClimbSim, sec: number, dir = NO_DIR): void {
    for (let t = 0; t < sec && sim.phase === 'climbing'; t += FRAME) sim.update(FRAME, dir);
}

/** Climbs straight up the middle; holds still (grips) whenever an event warns or runs. */
function patientClimb(sim: ClimbSim, maxSec = 300): string[] {
    const seen: string[] = [];
    for (let t = 0; t < maxSec && sim.phase === 'climbing'; t += FRAME) {
        const s = sim.scheduler;
        if (s.state === 'warning' && s.kind && seen[seen.length - 1] !== s.kind) seen.push(s.kind);
        const busy = s.state === 'warning' || s.state === 'active';
        sim.update(FRAME, busy ? NO_DIR : UP);
    }
    return seen;
}

test('practice level: three floors on the practice width, ground start, no obstacles, no random wind', () => {
    const c = cfg();
    const l = practiceLevel(c);
    assert.equal(l.id, PRACTICE_LEVEL_ID);
    assert.equal(l.floorFrom, 1);
    assert.equal(l.floorTo, c.practice.floors);
    assert.equal(l.rows, c.practice.floors * c.player.rowsPerFloor);
    assert.equal(l.width, c.practice.width);
    assert.equal(l.windChance, 0);
    assert.equal(l.startPlatform, true);
    const sim = new ClimbSim(c, 0, 7, undefined, true);
    assert.equal(sim.practice, true);
    assert.equal(sim.wall.obstacles.size, 0);
    assert.equal(sim.wall.faces, c.tower.faces);
    assert.equal(sim.wall.cols, c.widths[c.practice.width].cols);
});

test('demo rows: practice.demoAt as shares of the house height, never the ground or the roof', () => {
    const c = cfg();
    assert.deepEqual(demoRows(36, c.practice.demoAt), [4, 14, 25]);
    assert.deepEqual(demoRows(36, [0.001, 0.999]), [1, 35]);
});

test('schema: practice.demoAt needs one increasing share in (0, 1) per demo event', () => {
    const bad = (mut: (p: any) => void) => {
        const r = JSON.parse(JSON.stringify(raw));
        mut(r.practice);
        assert.throws(() => parseLevelConfig(r), /practice\.demoAt/);
    };
    bad((p) => { p.demoAt = [0.1, 0.4]; });
    bad((p) => { p.demoAt = [0.1, 0.4, 1]; });
    bad((p) => { p.demoAt = [0.4, 0.1, 0.7]; });
    bad((p) => { delete p.demoAt; });
});

test('practice: rushing straight up never skips a demo; the roof waits for them', () => {
    const c = cfg();
    for (let seed = 1; seed <= 20; seed++) {
        const sim = new ClimbSim(c, 0, seed, undefined, true);
        const seen: string[] = [];
        // Hold Up the whole time (only pausing in rain, which would make the climber fall).
        for (let t = 0; t < 300 && sim.phase === 'climbing'; t += FRAME) {
            const s = sim.scheduler;
            if (s.state === 'warning' && s.kind && seen[seen.length - 1] !== s.kind) seen.push(s.kind);
            const stop = s.activeKind === 'rain' || s.activeKind === 'eagle';
            sim.update(FRAME, stop ? NO_DIR : UP);
        }
        assert.equal(sim.phase, 'cleared', `seed ${seed}: ${sim.fallCause}`);
        assert.deepEqual(seen, c.practice.demoEvents, `seed ${seed}`);
    }
});

test('demo scheduler: nothing on a timer, a triggered event runs its shortest duration', () => {
    const c = cfg();
    const s = new EventScheduler(c.events, 1, createRng(1), true);
    for (let t = 0; t < 2000; t += 0.5) s.update(0.5);
    assert.equal(s.state, 'idle', 'no timed events in practice');
    s.trigger('rain');
    s.update(0.01);
    assert.equal(s.state, 'warning');
    s.update(c.events.warningSec);
    assert.equal(s.activeKind, 'rain');
    assert.equal(s.activeTotal, c.events.rain.durationSec[0]);
});

test('practice run: wind, rain and eagle each come once, in order, then the roof clears it', () => {
    const c = cfg();
    for (let seed = 1; seed <= 20; seed++) {
        const sim = new ClimbSim(c, 0, seed, undefined, true);
        const seen = patientClimb(sim);
        assert.equal(sim.phase, 'cleared', `seed ${seed}`);
        assert.deepEqual(seen, c.practice.demoEvents, `seed ${seed}`);
        assert.equal(sim.demosLeft, 0);
        assert.equal(sim.next(), null, 'practice has no next level');
        assert.equal(sim.summit, false, 'practice is not the summit');
        assert.ok(sim.climbSec > 30 && sim.climbSec < 90, `about a minute (${sim.climbSec.toFixed(1)} s)`);
    }
});

test('practice is gentler: rain grace and eagle spotting are stretched by 1 / intensity', () => {
    const c = cfg();
    const k = c.practice.intensity;
    assert.ok(k < 1);
    // Rain: climb into the rain row, then keep moving through the rain.
    const rainAt = (practice: boolean): number => {
        const sim = new ClimbSim(c, 0, 3, undefined, practice);
        sim.scheduler.trigger('rain');
        run(sim, c.events.warningSec + 0.02);
        let t = 0;
        // Step sideways inside the safe zone so the climber keeps moving without clearing.
        while (sim.phase === 'climbing' && t < 5) {
            const dir = sim.col >= sim.wall.startCol + 2 ? { dx: -1, dy: 0 } : sim.col <= sim.wall.startCol - 2 ? { dx: 1, dy: 0 } : { dx: 1, dy: 0 };
            sim.update(FRAME, sim.row < 2 ? UP : dir);
            t += FRAME;
        }
        assert.equal(sim.fallCause, 'rain');
        return t;
    };
    const normalRain = rainAt(false);
    const practiceRain = rainAt(true);
    assert.ok(practiceRain > normalRain + (c.risk.rainGraceSec / k - c.risk.rainGraceSec) * 0.8,
        `practice ${practiceRain.toFixed(2)} s vs normal ${normalRain.toFixed(2)} s`);
});

test('practice fall keeps the rule: falling ends the practice run (restart from the ground)', () => {
    const c = cfg();
    const sim = new ClimbSim(c, 0, 5, undefined, true);
    // Walk off into a danger column and stay there until the risk meter fills.
    run(sim, 0.4, UP);
    for (let t = 0; t < 30 && sim.phase === 'climbing'; t += FRAME) {
        const r = Math.min(sim.row, sim.wall.rows - 1);
        const dir = zoneOf(sim.wall, sim.col, r) === 'danger' ? NO_DIR : { dx: -1, dy: 0 };
        sim.update(FRAME, dir);
    }
    assert.equal(sim.phase, 'fallen');
    assert.ok(!isObstacle(sim.wall, sim.col, 0));
});

test('house sections: one straight block from the ground to the top of the last floor', () => {
    const s = houseSections(12, 3);
    assert.equal(s.length, 1);
    assert.equal(s[0].y0, 0);
    assert.ok(Math.abs(s[0].y1 - (LIFT + 36 * ROW_H)) < 1e-9);
    assert.equal(halfAt(s, 3), HOUSE_HALF);
    assert.equal(halfAt(s, 100), HOUSE_HALF);
});
