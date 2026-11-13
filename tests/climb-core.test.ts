import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseLevelConfig } from '../assets/scripts/config/LevelConfig.ts';
import {
    ClimbSim, EventScheduler, NO_DIR, buildWall, createRng, dirFromKeys, dirFromStick,
    formatClimbTime, hasSafeRoute, isObstacle, zoneOf,
} from '../assets/scripts/climb/ClimbCore.ts';

const raw = JSON.parse(readFileSync(new URL('../assets/resources/config/levels.json', import.meta.url), 'utf8'));
const cfg = () => parseLevelConfig(raw);
const UP = { dx: 0, dy: 1 };
const LEFT = { dx: -1, dy: 0 };
const FRAME = 1 / 60;

function run(sim: ClimbSim, sec: number, dir = NO_DIR): void {
    for (let t = 0; t < sec && sim.phase === 'climbing'; t += FRAME) sim.update(FRAME, dir);
}

/** Climbs straight up, side-stepping obstacles inside the safe zone. */
function autoClimb(sim: ClimbSim, maxSec = 300): void {
    for (let t = 0; t < maxSec && sim.phase === 'climbing'; t += FRAME) {
        let dir = UP;
        if (!sim.stepping && sim.row + 1 < sim.wall.rows && isObstacle(sim.wall, sim.col, sim.row + 1)) {
            const right = sim.col + 1;
            dir = zoneOf(sim.wall, right) === 'safe' && !isObstacle(sim.wall, right, sim.row) ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 };
        }
        sim.update(FRAME, dir);
    }
}

test('rng is deterministic per seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const xs = Array.from({ length: 5 }, () => a());
    assert.deepEqual(xs, Array.from({ length: 5 }, () => b()));
    assert.ok(xs.every((x) => x >= 0 && x < 1));
    assert.notDeepEqual(xs, Array.from({ length: 5 }, createRng(43)));
});

test('level 1 wall: 11 cols (2 danger | 7 safe | 2 danger), 96 rows, obstacles keep a safe route', () => {
    const c = cfg();
    for (let seed = 1; seed <= 200; seed++) {
        const wall = buildWall(c.widths.wide, c.levels[0], createRng(seed));
        assert.equal(wall.cols, 11);
        assert.equal(wall.rows, 96);
        assert.equal(wall.startCol, 5);
        assert.deepEqual([0, 1, 2, 8, 9, 10].map((col) => zoneOf(wall, col)), ['danger', 'danger', 'safe', 'safe', 'danger', 'danger']);
        assert.equal(zoneOf(wall, -1), 'out');
        assert.equal(wall.obstacles.size, 8, `seed ${seed}: one obstacle per 12 rows`);
        for (const key of wall.obstacles) assert.ok(key >= wall.cols, 'no obstacle on the start row');
        assert.ok(hasSafeRoute(wall));
    }
});

test('narrow walls still keep a safe route', () => {
    const c = cfg();
    for (let seed = 1; seed <= 50; seed++) {
        assert.ok(hasSafeRoute(buildWall(c.widths.xnarrow, c.levels[11], createRng(seed))));
    }
});

test('scheduler: level 1 has no wind; eagle at 300 s, rain at 600 s, one event at a time', () => {
    const c = cfg();
    const s = new EventScheduler(c.events, 0, createRng(1));
    const seen: string[] = [];
    let concurrent = 0;
    for (let t = 0; t < 1300; t += 0.05) {
        const before = s.state;
        s.update(0.05);
        if (before !== 'warning' && s.state === 'warning') seen.push(`${s.kind}@${Math.round(s.clock)}`);
        if (s.state !== 'idle' && s.kind === null) concurrent++;
    }
    assert.deepEqual(seen, ['eagle@300', 'rain@600', 'eagle@900', 'rain@1200']);
    assert.equal(concurrent, 0);
});

test('scheduler: warning -> active -> cooldown -> idle with configured lengths', () => {
    const c = cfg();
    const s = new EventScheduler(c.events, 0, createRng(1));
    const step = (sec: number) => { for (let t = 0; t < sec - 1e-9; t += 0.01) s.update(0.01); };
    step(300.005);
    assert.equal(s.state, 'warning');
    assert.equal(s.activeKind, null);
    step(c.events.warningSec);
    assert.equal(s.state, 'active');
    assert.equal(s.activeKind, 'eagle');
    step(c.events.eagle.durationSec[0] + 0.02);
    assert.equal(s.state, 'cooldown');
    step(c.events.cooldownSec + 0.02);
    assert.equal(s.state, 'idle');
});

test('scheduler: wind that collides with another event is skipped, rain is queued', () => {
    const c = cfg();
    const events = { ...c.events, rain: { ...c.events.rain, firstSec: 60, everySec: 1000 }, eagle: { ...c.events.eagle, firstSec: 70, everySec: 1000 } };
    const s = new EventScheduler(events, 1, createRng(3));
    const starts: string[] = [];
    for (let t = 0; t < 200; t += 0.05) {
        const before = s.state;
        s.update(0.05);
        if (before !== 'warning' && s.state === 'warning') starts.push(s.kind as string);
    }
    // 60 s: rain wins, wind skipped. 70 s: eagle queued behind rain. 120 s / 180 s: wind only if idle.
    assert.equal(starts[0], 'rain');
    assert.equal(starts[1], 'eagle');
    assert.ok(starts.slice(2).every((k) => k === 'wind'));
});

test('input: keys and eight-way stick with dead zone', () => {
    assert.deepEqual(dirFromKeys(true, false, true, false), { dx: -1, dy: 1 });
    assert.deepEqual(dirFromKeys(true, true, false, false), { dx: 0, dy: 0 });
    assert.deepEqual(dirFromStick(0.1, 0.1, 0.2), NO_DIR);
    assert.deepEqual(dirFromStick(0, 0.9, 0.2), { dx: 0, dy: 1 });
    assert.deepEqual(dirFromStick(0.6, 0.6, 0.2), { dx: 1, dy: 1 });
    assert.deepEqual(dirFromStick(-0.8, 0.1, 0.2), { dx: -1, dy: 0 });
});

test('one cell per cellSec; release grips after gripDelaySec', () => {
    const c = cfg();
    const sim = new ClimbSim(c, 0, 7);
    sim.update(FRAME, UP);
    assert.equal(sim.row, 1);
    assert.ok(sim.stepping);
    assert.equal(sim.gripping, false);
    run(sim, c.player.cellSec - 2 * FRAME, UP);
    assert.equal(sim.row, 1, 'still finishing the first step');
    run(sim, 0.1, NO_DIR);
    assert.equal(sim.stepping, false);
    run(sim, c.player.gripDelaySec + FRAME);
    assert.equal(sim.gripping, true);
});

test('danger zone adds risk; stepping past the outer column falls with "edge"', () => {
    const c = cfg();
    const sim = new ClimbSim(c, 0, 7);
    // 5 -> 4 -> 3 -> 2 are safe, 1 and 0 danger, -1 is the fall line.
    for (let i = 0; i < 4 && sim.phase === 'climbing'; i++) {
        run(sim, c.player.cellSec + FRAME, LEFT);
    }
    assert.equal(zoneOf(sim.wall, sim.col), 'danger');
    const before = sim.risk;
    run(sim, 1);
    assert.ok(sim.risk > before, 'risk rises while gripping in the danger zone');
    run(sim, 3 * (c.player.cellSec + FRAME), LEFT);
    assert.equal(sim.phase, 'fallen');
    assert.equal(sim.fallCause, 'edge');
});

test('risk reaching max in the danger zone also falls', () => {
    const c = cfg();
    const sim = new ClimbSim(c, 0, 7);
    run(sim, 4 * (c.player.cellSec + FRAME), LEFT);
    run(sim, 10);
    assert.equal(sim.phase, 'fallen');
    assert.equal(sim.fallCause, 'edge');
});

test('safe zone calms risk faster while gripping', () => {
    const c = cfg();
    const a = new ClimbSim(c, 0, 7);
    const b = new ClimbSim(c, 0, 7);
    a.risk = b.risk = 50;
    run(a, 1);
    run(b, 1, UP);
    assert.ok(b.risk < 50, 'climbing in the safe zone calms slowly');
    assert.ok(a.risk < b.risk, 'gripping calms faster');
});

test('cannot climb below 1F or into obstacles', () => {
    const c = cfg();
    const sim = new ClimbSim(c, 0, 7);
    run(sim, 1, { dx: 0, dy: -1 });
    assert.equal(sim.row, 0);
    const [key] = sim.wall.obstacles;
    const row = Math.floor(key / sim.wall.cols);
    const col = key % sim.wall.cols;
    sim.col = sim.fromCol = col;
    sim.row = sim.fromRow = row - 1;
    sim.update(FRAME, UP);
    assert.equal(sim.row, row - 1, 'blocked by the obstacle');
});

test('level 1 can be cleared by climbing to the 8F platform; time counts only climbing', () => {
    const c = cfg();
    const sim = new ClimbSim(c, 0, 12345);
    autoClimb(sim);
    assert.equal(sim.phase, 'cleared');
    assert.equal(sim.maxFloor, 8);
    assert.ok(sim.climbSec > 96 * c.player.cellSec - 1, `took ${sim.climbSec}s`);
    assert.ok(sim.climbSec < 60);
});

test('rain: moving longer than rainGraceSec falls; gripping is safe', () => {
    const c = cfg();
    const sim = new ClimbSim(c, 0, 7);
    run(sim, 600 + c.events.warningSec + 0.1);
    assert.equal(sim.scheduler.activeKind, 'rain');
    assert.equal(sim.phase, 'climbing');
    run(sim, 1, UP);
    assert.equal(sim.phase, 'fallen');
    assert.equal(sim.fallCause, 'rain');
});

test('eagle: stopping before spotSec is safe, moving through it falls', () => {
    const c = cfg();
    const sim = new ClimbSim(c, 0, 7);
    run(sim, 300 + c.events.warningSec + 0.05);
    assert.equal(sim.scheduler.activeKind, 'eagle');
    run(sim, c.events.eagle.spotSec / 2, UP);
    run(sim, 0.5);
    assert.equal(sim.phase, 'climbing');
    assert.equal(sim.eagleSpotSec, 0);
    run(sim, c.events.eagle.spotSec + 0.1, UP);
    assert.equal(sim.phase, 'fallen');
    assert.equal(sim.fallCause, 'eagle');
});

test('formats climbing time', () => {
    assert.equal(formatClimbTime(0), '0:00.0');
    assert.equal(formatClimbTime(65.37), '1:05.3');
});
