import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLAIN_Y, cityPlan, cloudPlan, skyStops, terrainHeight } from '../assets/scripts/climb/BasinShape.ts';
import {
    DUSK_BASIN, DUSK_TOWER, HOME_EYE, HOME_FOV, HOME_LOOK, LIGHT_GROUPS, cityLights, duskSky, duskStreaks, homeCityCap,
    homeCloud, homeEye, homeYawShift, tipLightOn, twinkle,
} from '../assets/scripts/climb/BasinShape.ts';
import { SPIRE_TIP, summitY } from '../assets/scripts/climb/TowerShape.ts';

const inUnit = (c: readonly number[]): boolean => c.every((v) => v >= 0 && v <= 1);

test('home camera stands above the hill and sees the whole tower', () => {
    for (const t of [0, 10, 20, 40, 60]) {
        const [x, y, z] = homeEye(t);
        assert.ok(y > PLAIN_Y + terrainHeight(x, z) + 5, `eye above ground at t=${t}`);
    }
    const d = Math.hypot(HOME_EYE[0], HOME_EYE[2]);
    const pitch = Math.atan2(HOME_LOOK[1] - HOME_EYE[1], d);
    const half = (HOME_FOV / 2) * (Math.PI / 180);
    const top = Math.atan2(summitY(12, 48) + SPIRE_TIP - HOME_EYE[1], d);
    assert.ok(top < pitch + half - 0.03, 'spire tip in view');
    // Looking slightly up: the horizon sits in the lower half, like the view from the hill.
    assert.ok(pitch > 0 && pitch < half);
});

test('dusk sky has the same elevations as the day sky, purple overhead and warm at the horizon', () => {
    const dusk = duskSky();
    assert.deepEqual(dusk.map(([e]) => e), skyStops(0, 0).map(([e]) => e));
    for (const [, c] of dusk) assert.ok(inUnit(c));
    const top = dusk[dusk.length - 1][1];
    assert.ok(top[2] > top[0] && top[2] > top[1], 'overhead is blue-purple');
    const horizon = dusk.find(([e]) => e === 0)![1];
    assert.ok(horizon[0] > horizon[2], 'horizon is peach');
});

test('dusk basin colours are valid and fade to haze with distance', () => {
    for (const [x, z] of [[100, 0], [-500, 0], [-1200, -300], [0, 900]]) {
        assert.ok(inUnit(DUSK_BASIN.terrain(x, z, terrainHeight(x, z))));
        assert.ok(inUnit(DUSK_BASIN.river(x, z)));
        assert.ok(inUnit(DUSK_BASIN.park(x, z)));
        assert.ok(inUnit(DUSK_BASIN.roof(x, z)));
        for (let t = 0; t < DUSK_BASIN.tones; t++) assert.ok(inUnit(DUSK_BASIN.wall(t, x, z, t % 2 === 0)));
    }
    const near = DUSK_BASIN.terrain(-200, 0, 120), far = DUSK_BASIN.terrain(-1400, 0, 120);
    assert.ok(far[0] + far[1] + far[2] > near[0] + near[1] + near[2], 'far ranges are lighter');
    for (const v of Object.values(DUSK_TOWER)) assert.match(v, /^#[0-9a-f]{6}$/);
});

test('city stays under the sight line to the tower, only between the camera and the tower', () => {
    // Half way along the line of sight the cap is well below the camera.
    const cap = homeCityCap(HOME_EYE[0] / 2, HOME_EYE[2] / 2);
    assert.ok(cap < HOME_EYE[1] && cap > 0);
    // Behind the tower and far off to the side nothing is capped.
    assert.equal(homeCityCap(-200, -40), Infinity);
    assert.equal(homeCityCap(0, 400), Infinity);
    const blocks = cityPlan({ cap: homeCityCap });
    const free = cityPlan();
    assert.equal(blocks.length, free.length, 'same blocks, only lower');
    assert.ok(blocks.every((b) => b.h <= Math.max(4, homeCityCap(b.x, b.z)) + 1e-9));
});

test('no cumulus on the Home screen, so nothing drifts across the tower', () => {
    assert.equal(cloudPlan().filter(homeCloud).length, 0);
});

test('the city round the camera stays low', () => {
    assert.ok(homeCityCap(HOME_EYE[0] + 40, HOME_EYE[2] - 60) < HOME_EYE[1] / 2);
});

test('city lights and streaks are deterministic and well formed', () => {
    const blocks = cityPlan({ cap: homeCityCap });
    const a = cityLights(blocks), b = cityLights(blocks);
    assert.deepEqual(a, b);
    assert.ok(a.length > 4000);
    for (const l of a) {
        assert.ok(l.y >= PLAIN_Y && l.size > 0 && inUnit(l.color));
        assert.ok(l.group >= 0 && l.group < LIGHT_GROUPS);
    }
    const s = duskStreaks();
    assert.ok(s.length > 0);
    for (const k of s) {
        assert.ok(k.y > HOME_EYE[1], 'streaks are in the sky');
        assert.ok(Math.abs(Math.hypot(k.ax, k.az) - 1) < 1e-9);
        assert.ok(inUnit(k.color));
    }
});

test('twinkle and tip light', () => {
    for (let t = 0; t < 10; t += 0.37) {
        for (let g = 0; g < LIGHT_GROUPS; g++) {
            const v = twinkle(g, t);
            assert.ok(v >= 0.72 - 1e-9 && v <= 1 + 1e-9);
        }
    }
    assert.equal(tipLightOn(0.1), true);
    assert.equal(tipLightOn(1.2), false);
});

test('the camera turns so the tower stands right of the left menu column', () => {
    const tall = homeYawShift(720 / 1280);
    const wide = homeYawShift(16 / 9);
    assert.ok(tall > 0.1 && tall < 0.4);
    assert.ok(wide > 0.2 && wide < 0.8);
    assert.ok(wide > tall);
});
