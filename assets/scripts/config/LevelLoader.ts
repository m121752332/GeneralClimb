import { JsonAsset, resources } from 'cc';
import { LevelConfig, parseLevelConfig } from './LevelConfig';

/** Path under assets/resources, without extension. */
const LEVELS_PATH = 'config/levels';

/** Loads and validates levels.json once; every caller shares the same result. */
export class LevelLoader {
    private static pending: Promise<LevelConfig> | null = null;

    static load(): Promise<LevelConfig> {
        if (!LevelLoader.pending) {
            LevelLoader.pending = LevelLoader.fetch().catch((err) => {
                LevelLoader.pending = null; // allow a retry after a failed load
                throw err;
            });
        }
        return LevelLoader.pending;
    }

    private static fetch(): Promise<LevelConfig> {
        return new Promise((resolve, reject) => {
            resources.load(LEVELS_PATH, JsonAsset, (err, asset) => {
                if (err) {
                    reject(err);
                    return;
                }
                try {
                    resolve(parseLevelConfig(asset.json));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }
}
