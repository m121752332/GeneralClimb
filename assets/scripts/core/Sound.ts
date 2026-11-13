import { AudioEngine } from './Audio';
import { settings } from './Settings';

let shared: AudioEngine | null = null;

/** The game's one audio engine, following the player's volume / mute settings. */
export function sound(): AudioEngine {
    if (!shared) shared = new AudioEngine(settings());
    return shared;
}
