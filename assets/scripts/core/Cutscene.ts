/**
 * Timing and camera math for the opening and the start-game push-in (GDD §7, ADR-07).
 * Pure TS (no `cc`) so it can be unit tested. Both cutscenes can be skipped.
 */

/** GDD §7: opening illustration, 3 s. */
export const INTRO_SEC = 3;
/** The opening fades into Home over this long (part of INTRO_SEC). */
export const INTRO_FADE_SEC = 0.45;
/** The illustration slowly zooms in by this much over the opening. */
export const INTRO_ZOOM = 0.16;
/** GDD §7: start-game cutscene, camera pushes in to the base of the tower, 2 s. */
export const PUSH_IN_SEC = 2;
/** Ignore skip input for this long, so the tap that started the game doesn't skip it too. */
export const SKIP_GRACE_SEC = 0.25;

/** Smoothstep 0..1. */
export function ease(x: number): number {
    const k = Math.min(1, Math.max(0, x));
    return k * k * (3 - 2 * k);
}

/** Opening: zoom scale and opacity (0..1) at `t` seconds. */
export function introFrame(t: number): { scale: number; opacity: number; done: boolean } {
    const scale = 1 + INTRO_ZOOM * ease(t / INTRO_SEC);
    const fadeFrom = INTRO_SEC - INTRO_FADE_SEC;
    const opacity = t <= fadeFrom ? 1 : Math.max(0, 1 - (t - fadeFrom) / INTRO_FADE_SEC);
    return { scale, opacity, done: t >= INTRO_SEC };
}

export interface CamPose {
    /** Camera position. */
    x: number;
    y: number;
    z: number;
    /** Height on the tower axis the camera looks at. */
    lookY: number;
}

/** How far out (× the play distance), how high above and how far up the tower the push-in starts. */
export const PUSH_FAR_K = 1.3;
export const PUSH_RISE = 18;
export const PUSH_LOOK_UP = 16;

/**
 * Start-game push-in: starts wide and high on the same side of the tower, looking up the
 * tower, then glides down and in to `end` (the normal climb view at the start of the level).
 * `t` is seconds into the cutscene; at PUSH_IN_SEC the pose is exactly `end`.
 */
export function pushInPose(end: CamPose, t: number): CamPose {
    const k = ease(t / PUSH_IN_SEC);
    const far = 1 + (PUSH_FAR_K - 1) * (1 - k);
    return {
        x: end.x * far,
        y: end.y + PUSH_RISE * (1 - k),
        z: end.z * far,
        lookY: end.lookY + PUSH_LOOK_UP * (1 - k),
    };
}
