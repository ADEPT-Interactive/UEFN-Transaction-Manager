type WebViewHost = {
  postMessage: (message: string) => void;
};

type WindowWithWebViewHost = Window & {
  chrome?: {
    webview?: WebViewHost;
  };
};

export function handleExternalLinkClick(
  event: { preventDefault: () => void },
  url: string,
) {
  const webview = (window as WindowWithWebViewHost).chrome?.webview;
  if (!webview) return;

  try {
    webview.postMessage(`open-external-url|${url}`);
    event.preventDefault();
  } catch {
    // Leave the anchor's normal target behavior intact if the host bridge is unavailable.
  }
}
