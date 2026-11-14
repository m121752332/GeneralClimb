import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    BASIN_MAX, CITY_MIN, CLOUD_LAYERS, CLOUD_MIN_DIST, HAZE, HILLS, PARKS, bearing, cityPlan, cloudPlan, cloudSpin,
    hazeAt, mountainFoot, riverBankDist, ridgeHeight, skyColorAt, skyStops, terrainHeight,
} from '../assets/scripts/climb/BasinShape.ts';

const DEG = Math.PI / 180;

test('bearing: 0 north (-z), 90 east (+x)', () => {
    assert.ok(Math.abs(bearing(0, -1)) < 1e-9);
    assert.ok(Math.abs(bearing(1, 0) - 90 * DEG) < 1e-9);
    assert.ok(Math.abs(bearing(0, 1) - 180 * DEG) < 1e-9);
    assert.ok(Math.abs(bearing(-1, 0) - 270 * DEG) < 1e-9);
});

test('mountains ring the whole basin, highest to the north, with a low river gap to the north-west', () => {
    for (let d = 0; d < 360; d += 2) {
        const b = d * DEG;
        const foot = mountainFoot(b);
        assert.ok(foot > 500 && foot < BASIN_MAX - 400, `foot ${foot} at ${d}°`);
        assert.ok(ridgeHeight(b) >= 20);
    }
    assert.ok(ridgeHeight(10 * DEG) > ridgeHeight(250 * DEG));
    assert.ok(ridgeHeight(319 * DEG) < 0.3 * ridgeHeight(10 * DEG));
    // The crest stays below the summit seen from the top (~270), so the view clears the ridge.
    let top = 0;
    for (let d = 0; d < 360; d += 1) {
        for (let r = 500; r <= BASIN_MAX; r += 20) {
            const b = d * DEG;
            top = Math.max(top, terrainHeight(Math.sin(b) * r, -Math.cos(b) * r));
        }
    }
    assert.ok(top > 150 && top < 300, `highest ${top}`);
});

test('the plain is flat round the tower apart from the hills', () => {
    for (let r = CITY_MIN; r < 500; r += 25) {
        for (let d = 0; d < 360; d += 15) {
            const x = Math.sin(d * DEG) * r, z = -Math.cos(d * DEG) * r;
            const nearHill = HILLS.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr * 1.6);
            if (!nearHill) assert.ok(terrainHeight(x, z) < 0.5, `flat at ${x},${z}`);
        }
    }
    const [hx, hz, , hh] = HILLS[0];
    assert.ok(Math.abs(terrainHeight(hx, hz) - hh) < 2);
});

test('rivers run through the plain and cut the mountains where they leave', () => {
    assert.ok(riverBankDist(0, -205) < 0);
    assert.ok(riverBankDist(0, 0) > 150, 'the tower stands well away from the water');
    // River mouth valley through the north-west mountains is low.
    const b = 319 * DEG;
    const r = mountainFoot(b) + 200;
    assert.ok(terrainHeight(-700, -820) < 30);
    assert.ok(terrainHeight(Math.sin(b) * r, -Math.cos(b) * r) < ridgeHeight(10 * DEG));
});

test('city: deterministic, dense near the tower, never on water, parks, hills or the orbit', () => {
    const a = cityPlan();
    const b = cityPlan();
    assert.deepEqual(a, b);
    assert.ok(a.length > 900 && a.length < 3000, `blocks ${a.length}`);
    for (const bl of a) {
        const r = Math.hypot(bl.x, bl.z);
        assert.ok(r >= CITY_MIN);
        assert.ok(r < mountainFoot(bearing(bl.x, bl.z)));
        assert.ok(riverBankDist(bl.x, bl.z) > 0);
        assert.ok(terrainHeight(bl.x, bl.z) <= 1.5);
        assert.ok(!PARKS.some(([px, pz, hx, hz]) => Math.abs(bl.x - px) < hx && Math.abs(bl.z - pz) < hz));
        assert.ok(bl.h > 0 && bl.h < 120);
    }
    const near = a.filter((bl) => Math.hypot(bl.x, bl.z) < 250).length / (Math.PI * (250 ** 2 - CITY_MIN ** 2));
    const far = a.filter((bl) => Math.hypot(bl.x, bl.z) > 330).length / (Math.PI * (460 ** 2 - 330 ** 2));
    assert.ok(near > 2 * far, `density near ${near} far ${far}`);
    // Keep-clear spots stay empty.
    const clear = cityPlan({ keepClear: [[0, -520, 20]] });
    assert.ok(!clear.some((bl) => Math.hypot(bl.x, bl.z + 520) < 20));
});

test('haze grows with distance and the far mountains nearly melt into it', () => {
    assert.equal(hazeAt(0), 0);
    assert.ok(hazeAt(300) < hazeAt(800));
    assert.ok(hazeAt(BASIN_MAX) > 0.5);
});

test('sky: layered gradient, deeper at the summit, grey in rain', () => {
    const low = skyStops(0, 0), high = skyStops(1, 0), storm = skyStops(0.5, 1);
    const sum = (c: readonly number[]) => c[0] + c[1] + c[2];
    // Bright at the horizon, darker blue overhead.
    assert.ok(sum(skyColorAt(low, 0)) > sum(skyColorAt(low, 1)));
    assert.ok(skyColorAt(low, 1)[2] > skyColorAt(low, 1)[0]);
    // Summit zenith is deeper than the plaza's.
    assert.ok(sum(skyColorAt(high, 1)) < sum(skyColorAt(low, 1)));
    // Rain: grey (little blue cast) and darker.
    const z = skyColorAt(storm, 0.5);
    assert.ok(z[2] - z[0] < 0.1);
    // Just below the horizon matches the terrain haze, so the edge of the land vanishes.
    const h = skyColorAt(low, -0.02);
    assert.ok(Math.abs(h[0] - HAZE[0]) < 1e-9 && Math.abs(h[2] - HAZE[2]) < 1e-9);
    // Interpolates between stops.
    const m = skyColorAt(low, 0.03), e0 = skyColorAt(low, 0), e1 = skyColorAt(low, 0.06);
    assert.ok(Math.abs(m[0] - (e0[0] + e1[0]) / 2) < 1e-9);
});

test('clouds: three layers, clear of the camera, drifting faster in wind', () => {
    const clouds = cloudPlan();
    assert.equal(clouds.length, CLOUD_LAYERS.reduce((n, l) => n + l[0], 0));
    for (const c of clouds) {
        const [, y0, y1] = CLOUD_LAYERS[c.layer];
        assert.ok(c.y >= y0 && c.y <= y1);
        const reach = Math.max(...c.puffs.map((p) => Math.hypot(p.x, p.z) + p.rx));
        assert.ok(c.dist - reach > CLOUD_MIN_DIST * 0.5, 'puffs stay well outside the camera orbit');
        assert.ok(c.puffs.length >= 4);
    }
    assert.ok(cloudSpin(2, 0) > cloudSpin(0, 0));
    assert.ok(cloudSpin(1, 1) > cloudSpin(1, 0) * 3);
});
