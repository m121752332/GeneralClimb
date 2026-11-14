// Site icons (favicon / apple-touch-icon) for the Web Mobile build.
// The icon files live in build-templates/web-mobile/, which Cocos Creator copies into the build root.
// Cocos' generated index.html has no icon links, so publish-site.mjs adds them with injectIconLinks().
// Regenerate the files from branding/gcr-icon.png when the logo changes.
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ICON_DIR = fileURLToPath(new URL('../build-templates/web-mobile', import.meta.url));
export const ICON_FILES = ['favicon.ico', 'favicon-32x32.png', 'apple-touch-icon.png'];
// Static pages linked from the account panel (ui/AccountPanel.ts). md5Cache renames the copies
// in the build (privacy.<hash>.html), so the plain names are copied in as well.
export const PAGE_FILES = ['privacy.html', 'terms.html'];

const MARKER = '<!-- site-icons -->';
export const ICON_LINKS = [
    MARKER,
    '<link rel="icon" href="favicon.ico" sizes="16x16 32x32 48x48">',
    '<link rel="icon" type="image/png" href="favicon-32x32.png" sizes="32x32">',
    '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
].join('\n  ');

/** Adds the icon links before </head>. Returns the html unchanged if they are already there. */
export function injectIconLinks(html) {
    if (html.includes(MARKER)) return html;
    if (!/<\/head>/i.test(html)) throw new Error('index.html has no </head>');
    return html.replace(/<\/head>/i, `  ${ICON_LINKS}\n</head>`);
}

/** Copies any icon file missing from dir (e.g. a build made without the build template). */
export function copyIconFiles(dir) {
    for (const name of [...ICON_FILES, ...PAGE_FILES]) {
        if (!existsSync(`${dir}/${name}`)) copyFileSync(`${ICON_DIR}/${name}`, `${dir}/${name}`);
    }
}
