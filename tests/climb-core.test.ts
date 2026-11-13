import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseLevelConfig } from '../assets/scripts/config/LevelConfig.ts';
import {
    ClimbSim, EventScheduler, NO_DIR, buildWall, dangerAt, flareFor, createRng, dirFromKeys, dirFromStick,
    formatClimbTime, hasSafeRoute, isObstacle, localCol, wrapCol, zoneOf,
} from '../assets/scripts/climb/ClimbCore.ts';

const raw = JSON.parse(readFileSync(new URL('../assets/resources/config/levels.json', import.meta.url), 'utf8'));
const cfg = () => parseLevelConfig(raw);
/** The original flat wall (tower.faces = 1): fall lines on both sides. */
const flatCfg = () => {
    const c = cfg();
    c.tower.faces = 1;
    return c;
};
const UP = { dx: 0, dy: 1 };
const LEFT = { dx: -1, dy: 0 };
const FRAME = 1 / 60;

function run(sim: ClimbSim, sec: number, dir = NO_DIR): void {
    for (let t = 0; t < sec && sim.phase === 'climbing'; t += FRAME) sim.update(FRAME, dir);
}

/** Takes exactly n steps in one direction, then lets go until the last step lands. */
function steps(sim: ClimbSim, n: number, dir: { dx: number; dy: number }): void {
    for (let i = 0; i < n && sim.phase === 'climbing'; i++) {
        sim.update(FRAME, dir);
        while (sim.stepping && sim.phase === 'climbing') sim.update(FRAME, NO_DIR);
    }
}

/** Climbs straight up, side-stepping obstacles inside the safe zone. */
function autoClimb(sim: ClimbSim, maxSec = 300): void {
    for (let t = 0; t < maxSec && sim.phase === 'climbing'; t += FRAME) {
        let dir = UP;
        const r = Math.min(sim.row, sim.wall.rows - 1);
        const centre = Math.floor(sim.wall.cols / 2);
        if (!sim.stepping && sim.row + 1 < sim.wall.rows && isObstacle(sim.wall, sim.col, sim.row + 1)) {
            const right = sim.col + 1;
            dir = zoneOf(sim.wall, right, r) === 'safe' && !isObstacle(sim.wall, right, sim.row) ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 };
        } else if (!sim.stepping && zoneOf(sim.wall, sim.col, r) !== 'safe') {
            dir = { dx: Math.sign(centre - sim.col), dy: 0 };
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

test('flat wall: danger zone adds risk; stepping past the outer column falls with "edge"', () => {
    const c = flatCfg();
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
    const c = flatCfg();
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
    const row = Math.floor(key / sim.wall.ring);
    const col = key % sim.wall.ring;
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

test('level 6: medium wall (9 cols), pagoda flare widens danger on the top 24 rows', () => {
    const c = cfg();
    const l6 = c.levels[5];
    const flare = flareFor(c.pagodaFlare, l6);
    assert.deepEqual(flare, { rows: 24, extra: 1 });
    assert.deepEqual(flareFor(c.pagodaFlare, c.levels[0]), { rows: 0, extra: 0 });
    for (let seed = 1; seed <= 100; seed++) {
        const wall = buildWall(c.widths.medium, l6, createRng(seed), flare);
        assert.equal(wall.cols, 9);
        assert.equal(wall.rows, 96);
        assert.equal(wall.obstacles.size, 16, `seed ${seed}: two obstacles per 12 rows`);
        assert.equal(dangerAt(wall, 71), 2);
        assert.equal(dangerAt(wall, 72), 3);
        assert.equal(zoneOf(wall, 2, 71), 'safe');
        assert.equal(zoneOf(wall, 2, 72), 'danger');
        assert.equal(zoneOf(wall, 6, 95), 'danger');
        assert.ok(hasSafeRoute(wall));
    }
});

test('schema requires events.wind.pushEverySec', () => {
    const bad = JSON.parse(JSON.stringify(raw));
    delete bad.events.wind.pushEverySec;
    assert.throws(() => parseLevelConfig(bad), /events\.wind\.pushEverySec/);
});

test('level 6 can be cleared; floors 43-50', () => {
    const c = cfg();
    const sim = new ClimbSim(c, 5, 99);
    assert.equal(sim.floor, 43);
    sim.scheduler.setWindChance(0);
    autoClimb(sim);
    assert.equal(sim.phase, 'cleared');
    assert.equal(sim.maxFloor, 50);
});

test('next level carries risk, time, scheduler and run max floor', () => {
    const c = cfg();
    const l1 = new ClimbSim(c, 0, 5);
    autoClimb(l1);
    assert.equal(l1.phase, 'cleared');
    l1.risk = 30;
    const l2 = l1.next();
    assert.ok(l2);
    assert.equal(l2.level.id, 2);
    assert.equal(l2.risk, 30);
    assert.equal(l2.climbSec, l1.climbSec);
    assert.equal(l2.scheduler, l1.scheduler);
    assert.equal(l2.seed, l1.seed);
    assert.equal(l2.floor, 9);
    assert.equal(l2.runMaxFloor, 9);
    assert.equal(new ClimbSim(c, 0, 5).next(), null, 'only after clearing');
    const l12 = new ClimbSim(c, 11, 5);
    l12.phase = 'cleared';
    assert.equal(l12.next(), null, 'spire is not built yet');
});

function windSim(c = cfg()): ClimbSim {
    const sim = new ClimbSim(c, 5, 11);
    sim.scheduler.setWindChance(1);
    run(sim, c.events.wind.firstSec + c.events.warningSec + 0.05);
    assert.equal(sim.scheduler.activeKind, 'wind');
    return sim;
}

test('wind: gripping is safe, moving adds risk and pushes outward', () => {
    const c = cfg();
    const sim = windSim();
    const risk0 = sim.risk;
    run(sim, 1);
    assert.equal(sim.col, sim.wall.startCol, 'not pushed while gripping');
    assert.ok(sim.risk <= risk0);
    // Step right once (off-centre), then keep climbing up: the gust pushes us further right.
    run(sim, c.player.cellSec + FRAME, { dx: 1, dy: 0 });
    const col = sim.col;
    run(sim, c.events.wind.pushEverySec + 0.2, UP);
    assert.ok(sim.col > col, `pushed outward from ${col} to ${sim.col}`);
    assert.ok(sim.risk > 0);
});

test('flat wall: wind pushing past the fall line falls with "wind"', () => {
    const sim = windSim(flatCfg());
    sim.col = sim.fromCol = sim.wall.cols - 1;
    run(sim, 6, UP);
    assert.equal(sim.phase, 'fallen');
    assert.equal(sim.fallCause, 'wind');
});

test('tower: four faces wrap; past the outer column goes round the corner, no edge fall', () => {
    const c = cfg();
    const sim = new ClimbSim(c, 0, 7);
    assert.equal(sim.wall.faces, 4);
    assert.equal(sim.wall.ring, 44);
    assert.equal(sim.wall.obstacles.size, 32, 'one obstacle per 12 rows per face');
    assert.ok(hasSafeRoute(sim.wall));
    // 5 -> 0 is face 0, one more step left lands on face 3's right-hand column.
    steps(sim, 6, LEFT);
    assert.equal(sim.phase, 'climbing');
    assert.equal(sim.col, 43);
    assert.equal(localCol(sim.wall, sim.col), 10);
    assert.equal(zoneOf(sim.wall, sim.col), 'danger', 'corners are danger on both sides');
    // Keep going: through the corner and into face 3's safe zone (risk 15/s for ~1.4 s is survivable).
    steps(sim, 3, LEFT);
    assert.equal(sim.phase, 'climbing');
    assert.equal(sim.col, 40);
    assert.equal(zoneOf(sim.wall, sim.col), 'safe');
});

test('tower: zones and obstacles repeat per face; wrapCol normalises', () => {
    const c = cfg();
    const wall = buildWall(c.widths.wide, c.levels[0], createRng(3), undefined, 4);
    assert.deepEqual([0, 1, 2, 10, 11, 12, 13, 21, 22, 43].map((col) => zoneOf(wall, col)),
        ['danger', 'danger', 'safe', 'danger', 'danger', 'danger', 'safe', 'danger', 'danger', 'danger']);
    assert.equal(wrapCol(wall, -1), 43);
    assert.equal(wrapCol(wall, 44), 0);
    assert.equal(zoneOf(wall, -1), 'danger', 'no fall line on a tower');
    for (const key of wall.obstacles) assert.equal(isObstacle(wall, key % 44, Math.floor(key / 44)), true);
});

test('tower: wind at a corner pushes round it instead of off the wall', () => {
    const sim = windSim();
    sim.col = sim.fromCol = sim.wall.cols - 1;
    run(sim, 1.3, UP);
    assert.notEqual(sim.fallCause, 'wind');
    assert.ok(sim.col >= sim.wall.cols, `pushed onto the next face, col ${sim.col}`);
});

test('schema: tower.faces must be 1 or 4', () => {
    const bad = JSON.parse(JSON.stringify(raw));
    bad.tower.faces = 3;
    assert.throws(() => parseLevelConfig(bad), /tower\.faces/);
    delete bad.tower;
    assert.throws(() => parseLevelConfig(bad), /tower/);
});
