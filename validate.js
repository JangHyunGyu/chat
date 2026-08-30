/**
 * Chat PWA Validation Script
 * node validate.js
 *
 * Checks:
 *  1. Required files exist
 *  2. HTML script/CSS references match actual files
 *  3. manifest.json is valid JSON with required PWA fields
 *  4. WebSocket URL in app.js / network.js is valid
 *  5. Service worker references valid cache files
 *  6. DOM IDs referenced in JS exist in HTML
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const errors = [];
const warnings = [];

function addError(check, msg) { errors.push(`[${check}] ${msg}`); }
function addWarning(check, msg) { warnings.push(`[${check}] ${msg}`); }

function fileExists(relPath) {
    return fs.existsSync(path.join(ROOT, relPath));
}

function readFile(relPath) {
    const full = path.join(ROOT, relPath);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full, 'utf-8');
}

function readPngDimensions(relPath) {
    const full = path.join(ROOT, relPath);
    if (!fs.existsSync(full)) return null;
    const data = fs.readFileSync(full);
    const pngSignature = '89504e470d0a1a0a';
    if (data.length < 24 || data.subarray(0, 8).toString('hex') !== pngSignature) return null;
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

// ═══════════════════════════════════════════
// 1. Required files exist
// ═══════════════════════════════════════════
const REQUIRED_FILES = [
    'index.html',
    'js/app.js',
    'js/network.js',
    'css/style.css',
    'manifest.json',
    'sw.js',
    'icons/icon.svg',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png',
];

console.log('\n--- 1. Required Files ---');
let allFilesExist = true;
for (const f of REQUIRED_FILES) {
    if (fileExists(f)) {
        console.log(`  \u2705 ${f}`);
    } else {
        console.log(`  \u274C ${f} - MISSING`);
        addError('files', `Required file missing: ${f}`);
        allFilesExist = false;
    }
}

// ═══════════════════════════════════════════
// 2. HTML script/CSS references match actual files
// ═══════════════════════════════════════════
console.log('\n--- 2. HTML Resource References ---');
const html = readFile('index.html');
if (html) {
    // Find <script src="..."> references
    const scriptRefs = [];
    const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["']/gi;
    let m;
    while ((m = scriptRegex.exec(html)) !== null) {
        scriptRefs.push(m[1]);
    }

    // Find <link rel="stylesheet" href="..."> references
    const cssRefs = [];
    const cssRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi;
    while ((m = cssRegex.exec(html)) !== null) {
        cssRefs.push(m[1]);
    }
    // Also match href before rel
    const cssRegex2 = /<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi;
    while ((m = cssRegex2.exec(html)) !== null) {
        if (!cssRefs.includes(m[1])) cssRefs.push(m[1]);
    }

    const allRefs = [...scriptRefs, ...cssRefs];
    for (const ref of allRefs) {
        // Strip query strings (cache busting)
        const cleanRef = ref.split('?')[0];
        // Skip external URLs
        if (cleanRef.startsWith('http://') || cleanRef.startsWith('https://')) {
            console.log(`  \u2705 ${ref} (external, skipped)`);
            continue;
        }
        if (fileExists(cleanRef)) {
            console.log(`  \u2705 ${ref}`);
        } else {
            console.log(`  \u274C ${ref} - file not found`);
            addError('html-refs', `HTML references non-existent file: ${ref}`);
        }
    }
    if (allRefs.length === 0) {
        console.log('  (no script/css references found)');
        addWarning('html-refs', 'No script or CSS references found in HTML');
    }

    const inlineHandlers = html.match(/\son[a-z]+\s*=/gi) || [];
    if (inlineHandlers.length === 0) {
        console.log('  ✅ No inline event handlers');
    } else {
        console.log(`  ❌ Found ${inlineHandlers.length} inline event handler(s)`);
        addError('html-events', 'Inline event handlers must be replaced with JavaScript listeners');
    }

    const appleTouchIcon = html.match(/<link\s+[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["'][^>]*>/i);
    const appleTouchDimensions = appleTouchIcon ? readPngDimensions(appleTouchIcon[1]) : null;
    if (appleTouchIcon && /\.png$/i.test(appleTouchIcon[1]) && appleTouchDimensions?.width === 180 && appleTouchDimensions?.height === 180) {
        console.log(`  ✅ Apple touch icon: ${appleTouchIcon[1]} (180x180)`);
    } else {
        console.log('  ❌ Apple touch icon must reference a local 180x180 PNG');
        addError('html-icons', 'apple-touch-icon must reference an existing 180x180 PNG');
    }

    const socialImageChecks = [
        ['og:image', /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+\.png)["'][^>]*>/i],
        ['twitter:image', /<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+\.png)["'][^>]*>/i],
    ];
    for (const [name, pattern] of socialImageChecks) {
        if (pattern.test(html)) {
            console.log(`  ✅ ${name} uses a PNG preview`);
        } else {
            console.log(`  ❌ ${name} PNG preview missing`);
            addError('html-icons', `${name} must reference a PNG preview image`);
        }
    }
} else {
    console.log('  \u274C Cannot check - index.html not readable');
}

// ═══════════════════════════════════════════
// 3. manifest.json validity
// ═══════════════════════════════════════════
console.log('\n--- 3. manifest.json Validation ---');
const manifestRaw = readFile('manifest.json');
if (manifestRaw) {
    try {
        const manifest = JSON.parse(manifestRaw);
        console.log(`  \u2705 Valid JSON`);

        const requiredFields = ['name', 'icons', 'start_url'];
        for (const field of requiredFields) {
            if (manifest[field] !== undefined && manifest[field] !== null) {
                console.log(`  \u2705 Field "${field}" present`);
            } else {
                console.log(`  \u274C Field "${field}" missing`);
                addError('manifest', `manifest.json missing required field: ${field}`);
            }
        }

        if (manifest.id === '/') {
            console.log('  ✅ Stable app id is "/"');
        } else {
            console.log('  ❌ Stable app id must be "/"');
            addError('manifest', 'manifest.json must define id as "/"');
        }

        // Check icons array is non-empty
        if (Array.isArray(manifest.icons) && manifest.icons.length > 0) {
            console.log(`  \u2705 icons array has ${manifest.icons.length} entry(ies)`);
            // Verify icon files exist
            for (const icon of manifest.icons) {
                const iconPath = icon.src.replace(/^\//, '');
                if (fileExists(iconPath)) {
                    console.log(`  \u2705 Icon file: ${icon.src}`);
                    if (icon.type === 'image/png') {
                        const dimensions = readPngDimensions(iconPath);
                        const declaredSize = /^(\d+)x(\d+)$/.exec(icon.sizes || '');
                        if (!dimensions || !declaredSize || dimensions.width !== Number(declaredSize[1]) || dimensions.height !== Number(declaredSize[2])) {
                            console.log(`  ❌ PNG dimensions do not match manifest: ${icon.src}`);
                            addError('manifest', `PNG dimensions do not match declared size: ${icon.src}`);
                        }
                    }
                } else {
                    console.log(`  \u274C Icon file missing: ${icon.src}`);
                    addError('manifest', `Icon file not found: ${icon.src}`);
                }
            }

            const hasPngSize = size => manifest.icons.some(icon =>
                icon.type === 'image/png' && icon.sizes === size && fileExists(icon.src.replace(/^\//, ''))
            );
            const hasMaskable = manifest.icons.some(icon =>
                icon.type === 'image/png' && /(^|\s)maskable(\s|$)/.test(icon.purpose || '')
            );
            for (const size of ['192x192', '512x512']) {
                if (hasPngSize(size)) {
                    console.log(`  ✅ Raster fallback: ${size}`);
                } else {
                    console.log(`  ❌ Raster fallback missing: ${size}`);
                    addError('manifest', `PNG icon with size ${size} is required`);
                }
            }
            if (hasMaskable) {
                console.log('  ✅ Dedicated maskable PNG icon');
            } else {
                console.log('  ❌ Dedicated maskable PNG icon missing');
                addError('manifest', 'A maskable PNG icon is required');
            }
        } else {
            console.log(`  \u274C icons array is empty or not an array`);
            addError('manifest', 'manifest.json icons must be a non-empty array');
        }

        // Check recommended fields
        const recommended = ['short_name', 'display', 'background_color', 'theme_color'];
        for (const field of recommended) {
            if (manifest[field]) {
                console.log(`  \u2705 Recommended field "${field}" present`);
            } else {
                console.log(`  \u26A0\uFE0F  Recommended field "${field}" missing`);
                addWarning('manifest', `manifest.json missing recommended field: ${field}`);
            }
        }
    } catch (e) {
        console.log(`  \u274C Invalid JSON: ${e.message}`);
        addError('manifest', `manifest.json is not valid JSON: ${e.message}`);
    }
} else {
    console.log('  \u274C manifest.json not readable');
}

// ═══════════════════════════════════════════
// 4. WebSocket URL validation
// ═══════════════════════════════════════════
console.log('\n--- 4. WebSocket URL ---');
const appJs = readFile('js/app.js');
const networkJs = readFile('js/network.js');

if (appJs || networkJs) {
    const combined = (appJs || '') + '\n' + (networkJs || '');
    const wsUrls = [];

    // Match wss:// or ws:// URLs in string literals
    const wsRegex = /['"`](wss?:\/\/[^'"`\s]+)['"`]/g;
    while ((m = wsRegex.exec(combined)) !== null) {
        wsUrls.push(m[1]);
    }

    if (wsUrls.length > 0) {
        for (const url of wsUrls) {
            try {
                const parsed = new URL(url);
                if (parsed.protocol === 'wss:' || parsed.protocol === 'ws:') {
                    console.log(`  \u2705 ${url} (valid ${parsed.protocol.replace(':', '').toUpperCase()} URL)`);
                    if (parsed.protocol === 'ws:') {
                        addWarning('websocket', `Insecure WebSocket URL: ${url} (consider wss://)`);
                    }
                } else {
                    console.log(`  \u274C ${url} - not a WebSocket URL`);
                    addError('websocket', `Invalid WebSocket protocol: ${url}`);
                }
            } catch (e) {
                console.log(`  \u274C ${url} - invalid URL: ${e.message}`);
                addError('websocket', `Invalid WebSocket URL: ${url}`);
            }
        }
    } else {
        console.log('  \u26A0\uFE0F  No WebSocket URLs found in JS files');
        addWarning('websocket', 'No WebSocket URLs found in js/app.js or js/network.js');
    }
} else {
    console.log('  \u274C Cannot check - JS files not readable');
}

// ═══════════════════════════════════════════
// 5. Service worker cache file references
// ═══════════════════════════════════════════
console.log('\n--- 5. Service Worker Cache Files ---');
const swJs = readFile('sw.js');
if (swJs) {
    // Extract the ASSETS array contents
    const assetsMatch = swJs.match(/(?:ASSETS|urlsToCache|CACHE_FILES|FILES_TO_CACHE)\s*=\s*\[([\s\S]*?)\]/);
    if (assetsMatch) {
        const assetsContent = assetsMatch[1];
        const assetUrls = [];
        const strRegex = /['"]([^'"]+)['"]/g;
        while ((m = strRegex.exec(assetsContent)) !== null) {
            assetUrls.push(m[1]);
        }

        for (const asset of assetUrls) {
            // '/' maps to index.html
            if (asset === '/' || asset === './') {
                if (fileExists('index.html')) {
                    console.log(`  \u2705 ${asset} -> index.html`);
                } else {
                    console.log(`  \u274C ${asset} -> index.html not found`);
                    addError('sw-cache', 'Service worker caches "/" but index.html is missing');
                }
                continue;
            }

            const cleanPath = asset.replace(/^\//, '').split('?')[0];
            if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
                console.log(`  \u2705 ${asset} (external, skipped)`);
                continue;
            }

            if (fileExists(cleanPath)) {
                console.log(`  \u2705 ${asset}`);
            } else {
                console.log(`  \u274C ${asset} - file not found`);
                addError('sw-cache', `Service worker caches non-existent file: ${asset}`);
            }
        }
    } else {
        console.log('  \u26A0\uFE0F  Could not find cache assets array in sw.js');
        addWarning('sw-cache', 'Could not parse ASSETS array from sw.js');
    }
} else {
    console.log('  \u274C sw.js not readable');
}

if (swJs) {
    if (!swJs.includes('e.waitUntil(') || !swJs.includes('result => result.cacheWrite')) {
        addError('sw-cache-lifetime', 'Service worker cache writes must extend the fetch event lifetime');
    }
    if (!/const copy = res\.clone\(\);[\s\S]*?cacheWrite = caches\.open/.test(swJs)) {
        addError('sw-cache-clone', 'Network responses must be cloned before asynchronous cache access');
    }
}

// ═══════════════════════════════════════════
// 6. DOM ID cross-reference (JS getElementById <-> HTML id)
// ═══════════════════════════════════════════
console.log('\n--- 6. DOM ID Cross-Reference ---');
if (html && appJs) {
    // Collect all IDs from HTML
    const htmlIds = new Set();
    const idRegex = /\bid=["']([^"']+)["']/g;
    while ((m = idRegex.exec(html)) !== null) {
        htmlIds.add(m[1]);
    }

    // Collect all getElementById references from JS files
    const jsContent = (appJs || '') + '\n' + (networkJs || '');
    const getByIdRegex = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
    const jsIds = new Set();
    while ((m = getByIdRegex.exec(jsContent)) !== null) {
        jsIds.add(m[1]);
    }

    // Collect literal IDs created dynamically in JavaScript.
    const runtimeIds = new Set();
    const assignedIdRegex = /\.id\s*=\s*['"]([^'"]+)['"]/g;
    const templateIdRegex = /\bid=["']([^"']+)["']/g;
    while ((m = assignedIdRegex.exec(jsContent)) !== null) runtimeIds.add(m[1]);
    while ((m = templateIdRegex.exec(jsContent)) !== null) runtimeIds.add(m[1]);

    let missingCount = 0;
    let matchCount = 0;
    const missingIds = [];

    for (const id of jsIds) {
        if (htmlIds.has(id) || runtimeIds.has(id)) {
            matchCount++;
        } else {
            missingIds.push(id);
            missingCount++;
        }
    }

    console.log(`  HTML defines ${htmlIds.size} IDs, JS references ${jsIds.size} IDs`);
    console.log(`  \u2705 ${matchCount} JS ID references found in HTML`);

    if (missingCount > 0) {
        // Some IDs may be created dynamically at runtime - treat as warnings if few
        for (const id of missingIds) {
            console.log(`  \u26A0\uFE0F  JS references "${id}" but not found in static HTML`);
            addWarning('dom-ids', `getElementById("${id}") not found in HTML (may be dynamic)`);
        }
    }

    // Also check: HTML IDs referenced nowhere in JS (informational only, don't warn)
    let unusedCount = 0;
    for (const id of htmlIds) {
        if (!jsIds.has(id)) unusedCount++;
    }
    if (unusedCount > 0) {
        console.log(`  (${unusedCount} HTML IDs not referenced by getElementById - normal for CSS/event targets)`);
    }
} else {
    console.log('  \u274C Cannot check - index.html or app.js not readable');
}

// ═══════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════
console.log('\n' + '='.repeat(50));
console.log('VALIDATION SUMMARY');
console.log('='.repeat(50));

if (warnings.length > 0) {
    console.log(`\n\u26A0\uFE0F  Warnings: ${warnings.length}`);
    for (const w of warnings) {
        console.log(`   - ${w}`);
    }
}

if (errors.length > 0) {
    console.log(`\n\u274C Errors: ${errors.length}`);
    for (const e of errors) {
        console.log(`   - ${e}`);
    }
    console.log(`\nResult: FAIL (${errors.length} error(s), ${warnings.length} warning(s))\n`);
    process.exit(1);
} else {
    console.log(`\n\u2705 All checks passed! (${warnings.length} warning(s))\n`);
    process.exit(0);
}
