import Gio from 'gi://Gio';

/**
 * Start the helper that updates the transcript index. It runs in its own process, so the shell
 * never waits for it.
 *
 * Args:
 *     extensionPath: The extension's folder; the helper is `src/history/indexer.js` in it.
 *     projectsDir: Claude Code's `projects` folder.
 *     indexPath: The index file, read only by the helper.
 *     summaryPath: The summary file the helper writes for the shell.
 *     keepDays: Days of history to keep; 0 keeps everything.
 *     onDone: Called once with true when the helper exited cleanly, false otherwise (also when
 *         it could not be started, in which case it is called before this function returns).
 *
 * Returns:
 *     The `Gio.Subprocess`, or null when it could not be started.
 */
export function runIndexer(extensionPath, projectsDir, indexPath, summaryPath, keepDays, onDone) {
    let process;
    try {
        process = Gio.Subprocess.new(
            ['gjs', '-m', `${extensionPath}/src/history/indexer.js`, projectsDir, indexPath,
                summaryPath, `${keepDays}`],
            Gio.SubprocessFlags.STDERR_PIPE);
    } catch (e) {
        console.warn('Claudometer: Cannot start the indexer:', e.message);
        onDone(false);
        return null;
    }

    process.communicate_utf8_async(null, null, (proc, result) => {
        let ok = false;
        try {
            const [, , stderr] = proc.communicate_utf8_finish(result);
            ok = proc.get_successful();
            if (!ok)
                console.warn('Claudometer: The indexer failed:', stderr?.trim());
        } catch (e) {
            console.warn('Claudometer: The indexer failed:', e.message);
        }
        onDone(ok);
    });
    return process;
}
