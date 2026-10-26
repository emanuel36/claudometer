import {randomBytes} from 'node:crypto';
import {mkdir, open, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';

/** Returns: The file's text, or null when it is missing or unreadable. */
export async function readText(file) {
    try {
        return await readFile(file, 'utf8');
    } catch {
        return null;
    }
}

/** Returns: The file's JSON, or null when it is missing or not JSON. */
export async function readJson(file) {
    const text = await readText(file);
    try {
        return text === null ? null : JSON.parse(text);
    } catch {
        return null;
    }
}

// A temp file renamed over the target, so a reader never sees half a file
export async function writeAtomically(file, text) {
    await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
    const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temp, text, {mode: 0o600});
    try {
        await rename(temp, file);
    } catch (e) {
        await rm(temp, {force: true});
        throw e;
    }
}

/**
 * Take a lock shared by every Claudometer process (CLI, status line, editors).
 *
 * Args:
 *     file: The lock file.
 *     staleMs: A lock older than this is from a process that died, and is taken over.
 *
 * Returns:
 *     A function that releases the lock, or null when another process holds it.
 */
export async function tryLock(file, staleMs = 60000) {
    await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const handle = await open(file, 'wx');
            await handle.writeFile(String(process.pid));
            await handle.close();
            return () => rm(file, {force: true});
        } catch (e) {
            if (e.code !== 'EEXIST')
                return null;
            const info = await stat(file).catch(() => null);
            if (info && Date.now() - info.mtimeMs < staleMs)
                return null;
            await rm(file, {force: true});
        }
    }
    return null;
}
