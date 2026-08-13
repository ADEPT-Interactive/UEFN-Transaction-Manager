using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace UEFNEntitlementManager.Desktop;

internal static class Program
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);

    [STAThread]
    private static void Main(string[] args)
    {
        SetCurrentProcessExplicitAppUserModelID("AD3PTInteractive.UEFNEntitlementManager");
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        try
        {
            if (args.Length == 1 && Uri.TryCreate(args[0], UriKind.Absolute, out var suppliedUri))
            {
                if (!IsLoopbackHttpUri(suppliedUri)) throw new InvalidOperationException("The manager will only open its authenticated local loopback app.");
                using var form = new ManagerForm(suppliedUri);
                Application.Run(form);
                return;
            }

            ProjectCandidate? selectedProject;
            if (args.Length == 2 && args[0].Equals("--project", StringComparison.OrdinalIgnoreCase))
            {
                selectedProject = ProjectDiscovery.ReadProject(args[1], ProjectSource.CommandLine, isActive: false);
                if (selectedProject is null) throw new InvalidOperationException("The supplied .uefnproject file is unavailable or does not contain an accessible Content folder.");
            }
            else if (args.Length == 0) selectedProject = SelectProject();
            else throw new InvalidOperationException("Start the manager normally, or supply --project followed by a .uefnproject file.");

            while (selectedProject is not null)
            {
                using var ownedBridge = BridgeSession.Start(selectedProject);
                using var form = new ManagerForm(ownedBridge.AppUri);
                Application.Run(form);
                if (!form.SwitchProjectRequested) return;
                selectedProject = SelectProject();
            }
        }
        catch (Exception error)
        {
            var diagnosticPath = DesktopDiagnostics.Write(error);
            MessageBox.Show(
                "The standalone manager could not start.\n\n"
                + "The Microsoft Edge WebView2 Runtime is required as a Windows app runtime; "
                + "this does not launch the Edge browser.\n\n"
                + error.Message
                + $"\n\nDiagnostic log: {diagnosticPath}",
                "UEFN Entitlement Manager",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Environment.ExitCode = 1;
        }
    }

    private static ProjectCandidate? SelectProject()
    {
        using var linker = new WebProjectLinkForm();
        return linker.ShowDialog() == DialogResult.OK ? linker.SelectedProject : null;
    }

    private static bool IsLoopbackHttpUri(Uri uri) =>
        uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
        && (uri.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)
            || uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase))
        && uri.Port is >= 1024 and <= 65535;
}

internal static class DesktopDiagnostics
{
    private static string GetLogPath()
    {
        var logRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "UEFN Entitlement Manager",
            "logs");
        Directory.CreateDirectory(logRoot);
        return Path.Combine(logRoot, $"desktop-shell-{Process.GetCurrentProcess().Id}.log");
    }

    public static string Write(Exception error)
    {
        var logPath = GetLogPath();
        File.WriteAllText(logPath, $"{DateTime.UtcNow:O}\n{error}");
        return logPath;
    }

    public static void Append(string message)
    {
        File.AppendAllText(GetLogPath(), $"{DateTime.UtcNow:O}\n{message}\n");
    }
}

internal sealed class ManagerForm : Form
{
    private const int ShellExecuteShowNormal = 1;
    private const int WindowNcHitTest = 0x0084;
    private const int WindowNcLeftButtonDown = 0x00A1;
    private const int HitClient = 1;
    private const int HitCaption = 2;
    private const int HitLeft = 10;
    private const int HitRight = 11;
    private const int HitTop = 12;
    private const int HitTopLeft = 13;
    private const int HitTopRight = 14;
    private const int HitBottom = 15;
    private const int HitBottomLeft = 16;
    private const int HitBottomRight = 17;

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr ShellExecute(
        IntPtr hwnd,
        string operation,
        string file,
        string? parameters,
        string? directory,
        int showCommand);

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

    private readonly Uri appUri;
    private readonly string allowedOrigin;
    private readonly string sessionToken;
    private readonly string userDataFolder;
    private WebView2? webView;
    private bool isClosing;
    private bool initializationStarted;
    private bool appHasUnsavedChanges;
    private bool allowClose;
    public bool SwitchProjectRequested { get; private set; }

    public ManagerForm(Uri appUri)
    {
        this.appUri = appUri;
        allowedOrigin = $"{appUri.Scheme}://{appUri.Host}:{appUri.Port}";
        sessionToken = ReadFragmentValue(appUri.Fragment, "token");
        userDataFolder = Path.Combine(
            Path.GetTempPath(),
            "UEFN Entitlement Manager",
            "WebView2",
            Process.GetCurrentProcess().Id.ToString());

        Text = "UEFN Entitlement Manager";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(960, 640);
        ClientSize = new Size(1400, 900);
        FormBorderStyle = FormBorderStyle.None;
        Padding = new Padding(1);
        BackColor = Color.FromArgb(30, 41, 59);
        SetStyle(ControlStyles.ResizeRedraw, true);
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? System.Drawing.SystemIcons.Application;
        ShowIcon = true;
        ShowInTaskbar = true;
    }

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(userDataFolder);

        webView = new WebView2
        {
            Dock = DockStyle.Fill,
            CreationProperties = null,
        };
        Controls.Add(webView);

        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
        await webView.EnsureCoreWebView2Async(environment);

        await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
            "Object.defineProperty(window, 'uemDesktopHost', { value: true, configurable: false, enumerable: false });");

        webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
        webView.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
        webView.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
        webView.CoreWebView2.NavigationStarting += OnNavigationStarting;
        webView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
        webView.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
        webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
        webView.CoreWebView2.ProcessFailed += OnProcessFailed;
        webView.Source = appUri;
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (initializationStarted) return;
        initializationStarted = true;

        try
        {
            await InitializeAsync();
        }
        catch (Exception error)
        {
            var diagnosticPath = DesktopDiagnostics.Write(error);
            MessageBox.Show(
                this,
                "The standalone manager could not start.\n\n"
                + "The Microsoft Edge WebView2 Runtime is required as a Windows app runtime; "
                + "this does not launch the Edge browser.\n\n"
                + error.Message
                + $"\n\nDiagnostic log: {diagnosticPath}",
                "UEFN Entitlement Manager",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Close();
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        isClosing = true;
        CloseBridgeSession();
        if (webView is not null)
        {
            webView.CoreWebView2?.Stop();
            webView.Dispose();
            webView = null;
        }

        TryRemoveUserDataFolder();
        base.OnFormClosed(e);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing && !allowClose && appHasUnsavedChanges && !isClosing)
        {
            e.Cancel = true;
            webView?.CoreWebView2?.PostWebMessageAsString("window-command|confirm-close");
            return;
        }
        base.OnFormClosing(e);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        UpdateMaximizedBounds();
    }

    protected override void OnLocationChanged(EventArgs e)
    {
        base.OnLocationChanged(e);
        if (WindowState == FormWindowState.Normal) UpdateMaximizedBounds();
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        SendWindowState();
    }

    protected override void WndProc(ref Message message)
    {
        base.WndProc(ref message);
        if (message.Msg != WindowNcHitTest || WindowState != FormWindowState.Normal || (int)message.Result != HitClient) return;

        var packed = message.LParam.ToInt64();
        var screenPoint = new Point(unchecked((short)(packed & 0xffff)), unchecked((short)((packed >> 16) & 0xffff)));
        var point = PointToClient(screenPoint);
        var grip = Math.Max(7, DeviceDpi * 7 / 96);
        var left = point.X <= grip;
        var right = point.X >= ClientSize.Width - grip;
        var top = point.Y <= grip;
        var bottom = point.Y >= ClientSize.Height - grip;

        if (left && top) message.Result = (IntPtr)HitTopLeft;
        else if (right && top) message.Result = (IntPtr)HitTopRight;
        else if (left && bottom) message.Result = (IntPtr)HitBottomLeft;
        else if (right && bottom) message.Result = (IntPtr)HitBottomRight;
        else if (left) message.Result = (IntPtr)HitLeft;
        else if (right) message.Result = (IntPtr)HitRight;
        else if (top) message.Result = (IntPtr)HitTop;
        else if (bottom) message.Result = (IntPtr)HitBottom;
    }

    private void CloseBridgeSession()
    {
        if (string.IsNullOrWhiteSpace(sessionToken))
        {
            DesktopDiagnostics.Append("Bridge shutdown skipped because the launch token was missing.");
            return;
        }

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                new Uri($"{allowedOrigin}/api/session/shutdown"));
            request.Headers.TryAddWithoutValidation("X-UEM-Token", sessionToken);
            using var response = client.SendAsync(request).GetAwaiter().GetResult();
            DesktopDiagnostics.Append($"Bridge shutdown response: {(int)response.StatusCode} {response.ReasonPhrase}");
        }
        catch (Exception error)
        {
            DesktopDiagnostics.Append($"Bridge shutdown request failed: {error.Message}");
            // The bridge's idle timeout remains the fallback if the window is
            // closing while the local bridge is already unavailable.
        }
    }

    private static string ReadFragmentValue(string fragment, string key)
    {
        foreach (var pair in fragment.TrimStart('#').Split(new[] { '&' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = pair.IndexOf('=');
            if (separator <= 0 || !pair.Substring(0, separator).Equals(key, StringComparison.Ordinal)) continue;
            return WebUtility.UrlDecode(pair.Substring(separator + 1)) ?? string.Empty;
        }
        return string.Empty;
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        DesktopDiagnostics.Append($"Navigation starting: {DescribeUri(e.Uri)}");
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var target))
        {
            e.Cancel = true;
            DesktopDiagnostics.Append("Navigation canceled because the URI was invalid.");
            return;
        }

        if (IsAppUri(target)) return;

        e.Cancel = true;
        OpenExternalBrowser(target);
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        const string externalUrlPrefix = "open-external-url|";
        string message;

        try
        {
            message = e.TryGetWebMessageAsString();
        }
        catch (Exception error)
        {
            DesktopDiagnostics.Append($"Web message rejected: {error.Message}");
            return;
        }

        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || !IsAppUri(source))
        {
            DesktopDiagnostics.Append("Web message rejected because it did not originate from the local app.");
            return;
        }

        const string windowActionPrefix = "window-action|";
        if (message.StartsWith(windowActionPrefix, StringComparison.Ordinal))
        {
            HandleWindowAction(message.Substring(windowActionPrefix.Length));
            return;
        }

        const string dirtyStatePrefix = "dirty-state|";
        if (message.StartsWith(dirtyStatePrefix, StringComparison.Ordinal))
        {
            appHasUnsavedChanges = message.Substring(dirtyStatePrefix.Length).Equals("true", StringComparison.Ordinal);
            return;
        }

        if (!message.StartsWith(externalUrlPrefix, StringComparison.Ordinal)) return;

        var rawUrl = message.Substring(externalUrlPrefix.Length);
        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var target))
        {
            DesktopDiagnostics.Append("External browser request rejected because the URI was invalid.");
            return;
        }

        DesktopDiagnostics.Append($"External browser message received: {DescribeUri(target)}");
        OpenExternalBrowser(target);
    }

    private void HandleWindowAction(string action)
    {
        switch (action)
        {
            case "request-state":
                SendWindowState();
                break;
            case "drag":
                if (WindowState == FormWindowState.Maximized) WindowState = FormWindowState.Normal;
                ReleaseCapture();
                SendMessage(Handle, WindowNcLeftButtonDown, (IntPtr)HitCaption, IntPtr.Zero);
                break;
            case "minimize":
                WindowState = FormWindowState.Minimized;
                break;
            case "toggle-maximize":
                WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
                SendWindowState();
                break;
            case "close":
                allowClose = true;
                Close();
                break;
            case "switch-project":
                SwitchProjectRequested = true;
                allowClose = true;
                Close();
                break;
            default:
                DesktopDiagnostics.Append($"Unknown window action rejected: {action}");
                break;
        }
    }

    private void SendWindowState()
    {
        if (webView?.CoreWebView2 is null) return;
        webView.CoreWebView2.PostWebMessageAsString(WindowState == FormWindowState.Maximized
            ? "window-state|maximized"
            : "window-state|normal");
    }

    private void UpdateMaximizedBounds()
    {
        if (IsHandleCreated) MaximizedBounds = Screen.FromHandle(Handle).WorkingArea;
    }

    private bool IsAppUri(Uri target) =>
        target.Scheme.Equals(appUri.Scheme, StringComparison.OrdinalIgnoreCase)
        && target.Host.Equals(appUri.Host, StringComparison.OrdinalIgnoreCase)
        && target.Port == appUri.Port;

    private static void OpenExternalBrowser(Uri target)
    {
        if (!target.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            && !target.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            DesktopDiagnostics.Append($"External browser request rejected for unsupported scheme: {target.Scheme}");
            return;
        }

        try
        {
            var result = ShellExecute(
                IntPtr.Zero,
                "open",
                target.AbsoluteUri,
                null,
                null,
                ShellExecuteShowNormal);
            var resultCode = result.ToInt64();
            if (resultCode <= 32) throw new InvalidOperationException($"ShellExecute returned {resultCode}.");
            DesktopDiagnostics.Append($"External browser requested for {target.Host} (ShellExecute={resultCode}).");
        }
        catch (Exception error)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = target.AbsoluteUri,
                    UseShellExecute = true,
                });
                DesktopDiagnostics.Append($"External browser fallback requested for {target.Host}.");
            }
            catch (Exception fallbackError)
            {
                DesktopDiagnostics.Append($"External browser launch failed for {target.Host}: {error.Message}; fallback: {fallbackError.Message}");
            }
        }
    }

    private static string DescribeUri(string rawUri)
    {
        return Uri.TryCreate(rawUri, UriKind.Absolute, out var target)
            ? DescribeUri(target)
            : "invalid URI";
    }

    private static string DescribeUri(Uri target) => $"{target.Scheme}://{target.Host}{target.AbsolutePath}";

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        DesktopDiagnostics.Append($"Dashboard navigation completed: success={e.IsSuccess}, error={e.WebErrorStatus}");
        if (e.IsSuccess) SendWindowState();
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        DesktopDiagnostics.Append($"New window requested: {DescribeUri(e.Uri)}");
        e.Handled = true;
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var target)
            && IsAppUri(target))
        {
            webView?.CoreWebView2.Navigate(e.Uri);
        }
        else if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var externalTarget))
        {
            OpenExternalBrowser(externalTarget);
        }
    }

    private void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        if (isClosing || IsDisposed) return;

        BeginInvoke(() => MessageBox.Show(
            this,
            $"The embedded manager UI stopped unexpectedly ({e.ProcessFailedKind}). Restart UEM and link the project again.",
            "UEFN Entitlement Manager",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error));
    }

    private void TryRemoveUserDataFolder()
    {
        try
        {
            if (Directory.Exists(userDataFolder)) Directory.Delete(userDataFolder, recursive: true);
        }
        catch
        {
            // WebView2 can keep a short-lived file lock after disposal. The
            // per-process folder is temporary and can be removed by Windows later.
        }
    }
}
