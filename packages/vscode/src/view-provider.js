import {randomBytes} from 'node:crypto';

import * as vscode from 'vscode';

/**
 * The usage panel: a webview that draws what the extension posts and sends back the user's
 * choices (tab, range, source, commands). It loads nothing from the network.
 */
export class UsageViewProvider {
    constructor(extensionUri, onMessage, onVisible) {
        this._extensionUri = extensionUri;
        this._onMessage = onMessage;
        this._onVisible = onVisible;
        this._view = null;
        this._last = null;
    }

    resolveWebviewView(view) {
        this._view = view;
        const media = vscode.Uri.joinPath(this._extensionUri, 'media');
        const dist = vscode.Uri.joinPath(this._extensionUri, 'dist');
        view.webview.options = {enableScripts: true, localResourceRoots: [media, dist]};
        const nonce = randomBytes(16).toString('base64');
        const css = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.css'));
        const js = view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'panel.js'));
        view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>Claudometer</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
        view.webview.onDidReceiveMessage(message => {
            if (message?.type === 'ready' && this._last)
                view.webview.postMessage(this._last);
            else
                this._onMessage(message);
        });
        view.onDidChangeVisibility(() => {
            if (view.visible)
                this._onVisible();
        });
        view.onDidDispose(() => {
            this._view = null;
        });
        this._onVisible();
    }

    get visible() {
        return Boolean(this._view?.visible);
    }

    post(state) {
        this._last = {type: 'state', state};
        this._view?.webview.postMessage(this._last);
    }
}
