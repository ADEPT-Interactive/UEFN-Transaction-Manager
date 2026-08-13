using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Drawing.Drawing2D;
using System.Web.Script.Serialization;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace UEFNEntitlementManager.Desktop;

internal enum ProjectSource
{
    Active = 0,
    LastOpened = 1,
    Recent = 2,
    Discovered = 3,
    Browse = 4,
    CommandLine = 5,
}

internal sealed class ProjectCandidate
{
    public string ProjectFile { get; set; } = string.Empty;
    public string ContentDirectory { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string AssetMount { get; set; } = string.Empty;
    public ProjectSource Source { get; set; }
    public bool IsActive { get; set; }
    public bool PythonEnabled { get; set; }
    public DateTime LastModifiedUtc { get; set; }

    public string SourceLabel => IsActive ? "Open in UEFN" : Source switch
    {
        ProjectSource.LastOpened => "Last opened",
        ProjectSource.Recent => "Recent project",
        ProjectSource.Browse => "Selected project",
        _ => "Project found",
    };
}

internal static class ProjectDiscovery
{
    private static readonly Regex OpenedProjectPattern = new(
        @"Successfully opened project '([^']+\.uefnproject)'",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex JsonTitlePattern = new(
        "\\\"title\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex RootPluginPattern = new(
        "\\{[^{}]*\\\"name\\\"\\s*:\\s*\\\"([A-Za-z_][A-Za-z0-9_]*)\\\"[^{}]*\\\"bIsRoot\\\"\\s*:\\s*true[^{}]*\\}",
        RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.Compiled);
    private static readonly Regex PythonEnabledPattern = new(
        "\\\"bEnablePythonForProject\\\"\\s*:\\s*true",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly HashSet<string> ProjectScanIgnoredDirectories = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", ".urc", ".vs", "Binaries", "Build", "Config", "Content", "DerivedDataCache",
        "Intermediate", "Plugins", "Saved", "Verse", "node_modules",
    };

    public static IReadOnlyList<ProjectCandidate> Discover()
    {
        var paths = new Dictionary<string, (ProjectSource Source, bool Active)>(StringComparer.OrdinalIgnoreCase);
        var uefnRunning = Process.GetProcessesByName("UnrealEditorFortnite-Win64-Shipping").Length > 0;
        var activePath = uefnRunning ? ReadActiveProjectFromCurrentLog() : null;
        AddPath(paths, activePath, ProjectSource.Active, active: true);

        var settingsPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "UnrealEditorFortnite", "Saved", "Config", "WindowsEditor", "EditorPerProjectUserSettings.ini");
        if (File.Exists(settingsPath))
        {
            try
            {
                foreach (var line in File.ReadLines(settingsPath))
                {
                    if (line.StartsWith("LastProjectFileName=", StringComparison.OrdinalIgnoreCase))
                        AddPath(paths, line.Substring(line.IndexOf('=') + 1), ProjectSource.LastOpened, active: false);
                    else if (line.StartsWith("AdditionalProjectFiles=", StringComparison.OrdinalIgnoreCase))
                        AddPath(paths, line.Substring(line.IndexOf('=') + 1), ProjectSource.Recent, active: false);
                }
            }
            catch (IOException error)
            {
                DesktopDiagnostics.Append($"Recent UEFN project settings could not be read: {error.Message}");
            }
        }

        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        DiscoverUnder(paths, Path.Combine(documents, "UEFN Projects"));
        DiscoverUnder(paths, Path.Combine(documents, "Fortnite Projects"));

        return paths
            .Select(entry => ReadProject(entry.Key, entry.Value.Source, entry.Value.Active))
            .Where(candidate => candidate is not null)
            .Cast<ProjectCandidate>()
            .OrderBy(candidate => candidate.Source)
            .ThenByDescending(candidate => candidate.LastModifiedUtc)
            .ThenBy(candidate => candidate.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public static bool IsProjectOpenInUefn(string projectFile)
    {
        using var process = FindOpenProjectProcess(projectFile);
        return process is not null;
    }

    public static Process? FindOpenProjectProcess(string projectFile)
    {
        var processes = Process.GetProcessesByName("UnrealEditorFortnite-Win64-Shipping");
        if (processes.Length == 0) return null;
        var activeProject = ReadActiveProjectFromCurrentLog();
        if (string.IsNullOrWhiteSpace(activeProject))
        {
            foreach (var process in processes) process.Dispose();
            return null;
        }
        try
        {
            if (!Path.GetFullPath(activeProject).Equals(Path.GetFullPath(projectFile), StringComparison.OrdinalIgnoreCase))
            {
                foreach (var process in processes) process.Dispose();
                return null;
            }
            var selected = processes.OrderByDescending(process => process.StartTime).First();
            foreach (var process in processes.Where(process => process.Id != selected.Id)) process.Dispose();
            return selected;
        }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException)
        {
            DesktopDiagnostics.Append($"Open-project comparison failed: {error.Message}");
            foreach (var process in processes) process.Dispose();
            return null;
        }
    }

    public static ProjectCandidate? ReadProject(string rawPath, ProjectSource source, bool isActive)
    {
        try
        {
            var projectFile = Path.GetFullPath(rawPath.Trim().Trim('"').Replace('/', Path.DirectorySeparatorChar));
            if (!projectFile.EndsWith(".uefnproject", StringComparison.OrdinalIgnoreCase) || !File.Exists(projectFile)) return null;
            var projectDirectory = Path.GetDirectoryName(projectFile);
            if (string.IsNullOrWhiteSpace(projectDirectory)) return null;

            var descriptor = File.ReadAllText(projectFile);
            var fallbackName = Path.GetFileNameWithoutExtension(projectFile);
            var title = JsonTitlePattern.Match(descriptor).Groups[1].Value.Trim();
            var rootPlugin = RootPluginPattern.Match(descriptor).Groups[1].Value;
            var assetMount = Regex.IsMatch(rootPlugin, "^[A-Za-z_][A-Za-z0-9_]*$") ? rootPlugin : fallbackName;
            if (!Regex.IsMatch(assetMount, "^[A-Za-z_][A-Za-z0-9_]*$")) return null;
            var contentDirectory = new[]
            {
                Path.Combine(projectDirectory, "Content"),
                Path.Combine(projectDirectory, "Plugins", assetMount, "Content"),
            }.FirstOrDefault(Directory.Exists);
            if (contentDirectory is null) return null;

            return new ProjectCandidate
            {
                ProjectFile = projectFile,
                ContentDirectory = Path.GetFullPath(contentDirectory),
                Name = string.IsNullOrWhiteSpace(title) ? fallbackName : title,
                AssetMount = assetMount,
                Source = isActive ? ProjectSource.Active : source,
                IsActive = isActive,
                PythonEnabled = PythonEnabledPattern.IsMatch(descriptor),
                LastModifiedUtc = File.GetLastWriteTimeUtc(projectFile),
            };
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            DesktopDiagnostics.Append($"UEFN project candidate was rejected: {error.Message}");
            return null;
        }
    }

    private static string? ReadActiveProjectFromCurrentLog()
    {
        var logPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "UnrealEditorFortnite", "Saved", "Logs", "UnrealEditorFortnite.log");
        if (!File.Exists(logPath)) return null;

        string? latest = null;
        try
        {
            using var stream = new FileStream(logPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var reader = new StreamReader(stream);
            while (reader.ReadLine() is { } line)
            {
                var match = OpenedProjectPattern.Match(line);
                if (match.Success) latest = match.Groups[1].Value;
            }
        }
        catch (IOException error)
        {
            DesktopDiagnostics.Append($"The current UEFN log could not be inspected: {error.Message}");
        }
        return latest;
    }

    private static void DiscoverUnder(Dictionary<string, (ProjectSource Source, bool Active)> paths, string root)
    {
        if (!Directory.Exists(root)) return;
        var pending = new Queue<(string Directory, int Depth)>();
        pending.Enqueue((root, 0));
        while (pending.Count > 0)
        {
            var current = pending.Dequeue();
            try
            {
                var descriptors = Directory.EnumerateFiles(current.Directory, "*.uefnproject", SearchOption.TopDirectoryOnly).ToArray();
                foreach (var projectFile in descriptors) AddPath(paths, projectFile, ProjectSource.Discovered, active: false);
                // A descriptor marks a project root. Its Content, plugins, and generated
                // folders can contain hundreds of thousands of files but no child project
                // that belongs in this launcher scan.
                if (descriptors.Length > 0 || current.Depth >= 4) continue;
                foreach (var directory in Directory.EnumerateDirectories(current.Directory, "*", SearchOption.TopDirectoryOnly))
                {
                    var info = new DirectoryInfo(directory);
                    if (ProjectScanIgnoredDirectories.Contains(info.Name)
                        || info.Name.StartsWith(".", StringComparison.Ordinal)
                        || info.Attributes.HasFlag(FileAttributes.ReparsePoint)) continue;
                    pending.Enqueue((directory, current.Depth + 1));
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                DesktopDiagnostics.Append($"Project discovery under {current.Directory} was incomplete: {error.Message}");
            }
        }
    }

    private static void AddPath(Dictionary<string, (ProjectSource Source, bool Active)> paths, string? rawPath, ProjectSource source, bool active)
    {
        if (string.IsNullOrWhiteSpace(rawPath)) return;
        try
        {
            var path = Path.GetFullPath(rawPath!.Trim().Trim('"').Replace('/', Path.DirectorySeparatorChar));
            if (paths.TryGetValue(path, out var existing))
            {
                if (active || source < existing.Source) paths[path] = (active ? ProjectSource.Active : source, active || existing.Active);
            }
            else paths[path] = (active ? ProjectSource.Active : source, active);
        }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException)
        {
            DesktopDiagnostics.Append($"Invalid UEFN project path ignored: {error.Message}");
        }
    }
}

internal sealed class ProjectLinkForm : Form
{
    private const int WindowNcLeftButtonDown = 0x00A1;
    private const int HitCaption = 2;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

    private readonly List<ProjectCandidate> projects;
    private readonly FlowLayoutPanel projectList;
    private readonly TextBox searchBox;
    private readonly Label selectionName;
    private readonly Label selectionDetails;
    private readonly Label pythonStatus;
    private readonly Button continueButton;
    private readonly Label discoveryStatus;
    private readonly List<ProjectCard> cards = new();

    public ProjectCandidate? SelectedProject { get; private set; }

    public ProjectLinkForm()
    {
        projects = new List<ProjectCandidate>();
        Text = "Link a UEFN project";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(960, 720);
        MinimumSize = new Size(820, 620);
        FormBorderStyle = FormBorderStyle.None;
        BackColor = Color.FromArgb(8, 12, 20);
        ForeColor = Color.White;
        Padding = new Padding(1);
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? System.Drawing.SystemIcons.Application;
        ShowIcon = true;
        ShowInTaskbar = true;

        var chrome = new Panel { Dock = DockStyle.Top, Height = 34, BackColor = Color.FromArgb(8, 13, 25) };
        chrome.MouseDown += (_, eventArgs) =>
        {
            if (eventArgs.Button != MouseButtons.Left) return;
            ReleaseCapture();
            SendMessage(Handle, WindowNcLeftButtonDown, (IntPtr)HitCaption, IntPtr.Zero);
        };
        var minimize = MakeChromeButton("—", Color.FromArgb(148, 163, 184));
        minimize.Click += (_, _) => WindowState = FormWindowState.Minimized;
        var close = MakeChromeButton("×", Color.FromArgb(251, 113, 133));
        close.Click += (_, _) => Close();
        chrome.Controls.Add(close);
        chrome.Controls.Add(minimize);
        close.Dock = DockStyle.Right;
        minimize.Dock = DockStyle.Right;

        var heading = new Panel { Dock = DockStyle.Top, Height = 108, Padding = new Padding(30, 14, 30, 12), BackColor = Color.FromArgb(8, 13, 25) };
        var iconPod = new RoundedPanel { Size = new Size(50, 50), Location = new Point(30, 16), CornerRadius = 12, BackColor = Color.FromArgb(15, 22, 41), BorderColor = Color.FromArgb(30, 41, 59) };
        var uemIcon = new PictureBox { Image = LoadLauncherMark(), SizeMode = PictureBoxSizeMode.Zoom, Size = new Size(42, 42), Location = new Point(4, 4), BackColor = Color.Transparent };
        iconPod.Controls.Add(uemIcon);
        var title = new Label { Text = "UEFN Entitlement Manager", AutoSize = true, Font = new Font("Segoe UI", 16, FontStyle.Bold), ForeColor = Color.White, Location = new Point(94, 18) };
        var subtitle = new Label { Text = "Choose the UEFN project you want to manage.", AutoSize = true, Font = new Font("Segoe UI", 9), ForeColor = Color.FromArgb(148, 163, 184), Location = new Point(96, 48) };
        var brand = new RoundedPanel { Size = new Size(105, 20), Location = new Point(95, 70), CornerRadius = 10, BackColor = Color.FromArgb(13, 46, 62), BorderColor = Color.FromArgb(23, 86, 105) };
        brand.Controls.Add(new Label { Text = "PROJECT LINK", AutoSize = true, Font = new Font("Segoe UI", 7, FontStyle.Bold), ForeColor = Color.FromArgb(103, 232, 249), Location = new Point(14, 3), BackColor = Color.Transparent });
        var adeptHost = new Panel { Dock = DockStyle.Right, Width = 230, BackColor = Color.FromArgb(8, 13, 25) };
        var adeptPanel = new RoundedPanel { Size = new Size(216, 52), Location = new Point(0, 14), CornerRadius = 12, BackColor = Color.FromArgb(12, 31, 45), BorderColor = Color.FromArgb(27, 101, 121) };
        var adeptImagePath = Path.Combine(AppContext.BaseDirectory, "adept-insignia.png");
        if (File.Exists(adeptImagePath)) adeptPanel.Controls.Add(new PictureBox { ImageLocation = adeptImagePath, SizeMode = PictureBoxSizeMode.Zoom, Size = new Size(28, 28), Location = new Point(12, 12), BackColor = Color.Transparent });
        adeptPanel.Controls.Add(new Label { Text = "CREATED BY", AutoSize = true, Font = new Font("Segoe UI", 6.5f, FontStyle.Bold), ForeColor = Color.FromArgb(100, 116, 139), Location = new Point(50, 9), BackColor = Color.Transparent });
        adeptPanel.Controls.Add(new Label { Text = "ADEPT INTERACTIVE", AutoSize = true, Font = new Font("Segoe UI", 8.5f, FontStyle.Bold), ForeColor = Color.White, Location = new Point(50, 25), BackColor = Color.Transparent });
        adeptHost.Controls.Add(adeptPanel);
        heading.Controls.Add(iconPod);
        heading.Controls.Add(title);
        heading.Controls.Add(subtitle);
        heading.Controls.Add(brand);
        heading.Controls.Add(adeptHost);

        var searchRow = new Panel { Dock = DockStyle.Top, Height = 64, Padding = new Padding(30, 12, 30, 10), BackColor = Color.FromArgb(9, 14, 26) };
        var searchShell = new RoundedPanel { Dock = DockStyle.Fill, Padding = new Padding(14, 8, 14, 7), CornerRadius = 10, BackColor = Color.FromArgb(15, 22, 41), BorderColor = Color.FromArgb(30, 41, 59) };
        searchBox = new TextBox { Dock = DockStyle.Fill, Font = new Font("Segoe UI", 10), BackColor = Color.FromArgb(15, 23, 42), ForeColor = Color.White, BorderStyle = BorderStyle.None };
        searchBox.TextChanged += (_, _) => RefreshProjectCards();
        var browseButton = MakeActionButton("Browse for .uefnproject", primary: false);
        browseButton.Dock = DockStyle.Right;
        browseButton.Width = 190;
        browseButton.Margin = new Padding(10, 0, 0, 0);
        browseButton.Click += (_, _) => BrowseForProject();
        searchShell.Controls.Add(searchBox);
        searchRow.Controls.Add(searchShell);
        searchRow.Controls.Add(browseButton);

        projectList = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoScroll = true,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            Padding = new Padding(24, 12, 16, 12),
            BackColor = Color.FromArgb(8, 12, 20),
        };
        projectList.SizeChanged += (_, _) => ResizeCards();

        var selection = new Panel { Dock = DockStyle.Bottom, Height = 170, Padding = new Padding(30, 12, 30, 16), BackColor = Color.FromArgb(8, 12, 20) };
        var selectionPod = new RoundedPanel { Dock = DockStyle.Fill, Padding = new Padding(20, 14, 18, 14), CornerRadius = 12, BackColor = Color.FromArgb(15, 22, 41), BorderColor = Color.FromArgb(30, 41, 59) };
        selectionName = new Label { Text = "Select a project to continue", AutoSize = false, Height = 27, Dock = DockStyle.Top, Font = new Font("Segoe UI", 11, FontStyle.Bold), ForeColor = Color.White };
        selectionDetails = new Label { AutoEllipsis = true, AutoSize = false, Height = 25, Dock = DockStyle.Top, Font = new Font("Segoe UI", 8.5f), ForeColor = Color.FromArgb(148, 163, 184) };
        pythonStatus = new Label { AutoSize = false, Height = 44, Dock = DockStyle.Top, Font = new Font("Segoe UI", 8.5f, FontStyle.Bold), ForeColor = Color.FromArgb(251, 191, 36) };
        continueButton = MakeActionButton("Open project in UEM", primary: true);
        continueButton.Dock = DockStyle.Fill;
        continueButton.Margin = new Padding(16, 18, 0, 18);
        continueButton.Enabled = false;
        continueButton.Click += (_, _) => { if (SelectedProject is not null) DialogResult = DialogResult.OK; };
        var footerLayout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = Padding.Empty, Padding = Padding.Empty };
        footerLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 74));
        footerLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 26));
        var footerText = new Panel { Dock = DockStyle.Fill };
        footerText.Controls.Add(pythonStatus);
        footerText.Controls.Add(selectionDetails);
        footerText.Controls.Add(selectionName);
        footerLayout.Controls.Add(footerText, 0, 0);
        footerLayout.Controls.Add(continueButton, 1, 0);
        selectionPod.Controls.Add(footerLayout);
        selection.Controls.Add(selectionPod);

        discoveryStatus = new Label { Text = "Finding active and recent UEFN projects…", AutoSize = false, Dock = DockStyle.Top, Height = 24, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(30, 0, 0, 0), Font = new Font("Segoe UI", 8.5f), ForeColor = Color.FromArgb(100, 116, 139) };

        Controls.Add(projectList);
        Controls.Add(selection);
        Controls.Add(discoveryStatus);
        Controls.Add(searchRow);
        Controls.Add(heading);
        Controls.Add(chrome);

        Shown += async (_, _) => await LoadProjectsAsync();
    }

    private async Task LoadProjectsAsync()
    {
        var started = Stopwatch.StartNew();
        IReadOnlyList<ProjectCandidate> discovered;
        try { discovered = await Task.Run(ProjectDiscovery.Discover); }
        catch (Exception error)
        {
            DesktopDiagnostics.Append($"Background project discovery failed: {error}");
            discoveryStatus.Text = "Automatic discovery was unavailable. Browse to a .uefnproject file instead.";
            discoveryStatus.ForeColor = Color.FromArgb(251, 191, 36);
            return;
        }
        if (IsDisposed) return;
        projects.Clear();
        projects.AddRange(discovered);
        RefreshProjectCards();
        discoveryStatus.Text = projects.Count == 0
            ? "No local projects were found. Browse to a .uefnproject file."
            : $"Found {projects.Count} projects in {started.ElapsedMilliseconds} ms. Showing the most relevant first; search to filter all projects.";
        var active = projects.FirstOrDefault(project => project.IsActive);
        if (active is not null) SelectProject(active);
    }

    private static Button MakeChromeButton(string text, Color foreground) => new()
    {
        Text = text,
        Width = 44,
        FlatStyle = FlatStyle.Flat,
        FlatAppearance = { BorderSize = 0, MouseOverBackColor = Color.FromArgb(30, 41, 59) },
        BackColor = Color.Transparent,
        ForeColor = foreground,
        Font = new Font("Segoe UI", 12),
        TabStop = false,
    };

    private static Image LoadLauncherMark()
    {
        var iconPath = Path.Combine(AppContext.BaseDirectory, "uem-icon.ico");
        if (File.Exists(iconPath))
        {
            using var highResolutionIcon = new Icon(iconPath, new Size(64, 64));
            return highResolutionIcon.ToBitmap();
        }
        return SystemIcons.Application.ToBitmap();
    }

    private static Button MakeActionButton(string text, bool primary) => new CapsuleButton(primary)
    {
        Text = text,
        Height = 42,
        ForeColor = primary ? Color.FromArgb(8, 15, 26) : Color.FromArgb(226, 232, 240),
        Font = new Font("Segoe UI", 9, FontStyle.Bold),
        Cursor = Cursors.Hand,
    };

    private void RefreshProjectCards()
    {
        projectList.SuspendLayout();
        projectList.Controls.Clear();
        cards.Clear();
        var query = searchBox.Text.Trim();
        var visibleProjects = projects.Where(project => query.Length == 0
                     || project.Name.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0
                     || project.ProjectFile.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0)
            .Take(query.Length == 0 ? 14 : 40);
        foreach (var project in visibleProjects)
        {
            var card = new ProjectCard(project);
            card.Clicked += (_, _) => SelectProject(project);
            cards.Add(card);
            projectList.Controls.Add(card);
        }
        ResizeCards();
        projectList.ResumeLayout();
    }

    private void ResizeCards()
    {
        var width = Math.Max(300, projectList.ClientSize.Width - projectList.Padding.Horizontal - (projectList.VerticalScroll.Visible ? 18 : 2));
        foreach (var card in cards) card.Width = width;
    }

    private void SelectProject(ProjectCandidate project)
    {
        SelectedProject = project;
        foreach (var card in cards) card.SetSelected(ReferenceEquals(card.Project, project));
        selectionName.Text = project.IsActive ? $"{project.Name} — active in UEFN" : project.Name;
        selectionDetails.Text = project.ProjectFile;
        pythonStatus.Text = project.PythonEnabled
            ? "Python Editor Scripting is enabled. UEM will install and attach native texture importing automatically."
            : "Python Editor Scripting is disabled. UEM can still manage Verse; enable it for native texture importing. UEM detects the change immediately.";
        pythonStatus.ForeColor = project.PythonEnabled ? Color.FromArgb(52, 211, 153) : Color.FromArgb(251, 191, 36);
        continueButton.Enabled = true;
    }

    private void BrowseForProject()
    {
        using var dialog = new OpenFileDialog
        {
            Filter = "UEFN project (*.uefnproject)|*.uefnproject",
            Title = "Link a UEFN project",
            CheckFileExists = true,
            Multiselect = false,
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        var project = ProjectDiscovery.ReadProject(dialog.FileName, ProjectSource.Browse, isActive: false);
        if (project is null)
        {
            SelectedProject = null;
            selectionName.Text = "Project could not be linked";
            selectionDetails.Text = "Choose a .uefnproject file whose project folder contains an accessible Content directory.";
            pythonStatus.Text = "Nothing was changed.";
            pythonStatus.ForeColor = Color.FromArgb(251, 113, 133);
            continueButton.Enabled = false;
            return;
        }
        projects.RemoveAll(candidate => candidate.ProjectFile.Equals(project.ProjectFile, StringComparison.OrdinalIgnoreCase));
        projects.Insert(0, project);
        searchBox.Clear();
        RefreshProjectCards();
        SelectProject(project);
    }
}

internal static class LauncherShapes
{
    public static GraphicsPath RoundedRectangle(Rectangle bounds, int radius)
    {
        var diameter = Math.Max(2, Math.Min(radius * 2, Math.Min(bounds.Width, bounds.Height)));
        var path = new GraphicsPath();
        path.AddArc(bounds.X, bounds.Y, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Y, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal class RoundedPanel : Panel
{
    public int CornerRadius { get; set; } = 12;
    public Color BorderColor { get; set; } = Color.FromArgb(51, 65, 85);

    public RoundedPanel()
    {
        DoubleBuffered = true;
        SetStyle(ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
    }

    // GDI Regions are rasterized as hard stair-steps. Leave the control
    // rectangular for hit testing and paint the visible surface anti-aliased.
    protected override void OnPaintBackground(PaintEventArgs e) { }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var bounds = ClientRectangle;
        bounds.Width--;
        bounds.Height--;
        using var path = LauncherShapes.RoundedRectangle(bounds, CornerRadius);
        using var fill = new SolidBrush(BackColor);
        using var border = new Pen(BorderColor);
        e.Graphics.FillPath(fill, path);
        e.Graphics.DrawPath(border, path);
        base.OnPaint(e);
    }
}

internal sealed class CapsuleButton : Button
{
    private readonly bool primary;
    private bool hovered;

    public CapsuleButton(bool primary)
    {
        this.primary = primary;
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        UseVisualStyleBackColor = false;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        MouseEnter += (_, _) => { hovered = true; Invalidate(); };
        MouseLeave += (_, _) => { hovered = false; Invalidate(); };
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var bounds = ClientRectangle;
        bounds.Width--;
        bounds.Height--;
        var fillColor = !Enabled ? Color.FromArgb(31, 41, 55)
            : primary ? (hovered ? Color.FromArgb(103, 232, 249) : Color.FromArgb(34, 211, 238))
            : (hovered ? Color.FromArgb(30, 41, 59) : Color.FromArgb(15, 23, 42));
        using var path = LauncherShapes.RoundedRectangle(bounds, Math.Min(10, Height / 2));
        using var fill = new SolidBrush(fillColor);
        using var border = new Pen(primary ? fillColor : Color.FromArgb(71, 85, 105));
        e.Graphics.FillPath(fill, path);
        e.Graphics.DrawPath(border, path);
        TextRenderer.DrawText(e.Graphics, Text, Font, bounds, Enabled ? ForeColor : Color.FromArgb(100, 116, 139), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
    }
}

internal sealed class ProjectCard : Panel
{
    public ProjectCandidate Project { get; }
    public event EventHandler? Clicked;
    private bool isSelected;
    private bool hovered;

    public ProjectCard(ProjectCandidate project)
    {
        Project = project;
        Height = 86;
        Margin = new Padding(6, 5, 6, 5);
        Padding = new Padding(16, 11, 16, 8);
        BackColor = project.IsActive ? Color.FromArgb(8, 42, 55) : Color.FromArgb(15, 23, 42);
        Cursor = Cursors.Hand;
        DoubleBuffered = true;
        SetStyle(ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);

        var name = new Label { Text = project.Name, AutoSize = false, Dock = DockStyle.Top, Height = 24, Font = new Font("Segoe UI", 10, FontStyle.Bold), ForeColor = Color.White };
        var path = new Label { Text = project.ProjectFile, AutoEllipsis = true, AutoSize = false, Dock = DockStyle.Top, Height = 20, Font = new Font("Segoe UI", 8), ForeColor = Color.FromArgb(148, 163, 184) };
        var status = new Label { Text = $"{project.SourceLabel}  •  {(project.PythonEnabled ? "Python enabled" : "Native imports need Python")}", AutoSize = false, Dock = DockStyle.Fill, Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = project.IsActive ? Color.FromArgb(103, 232, 249) : Color.FromArgb(100, 116, 139) };
        Controls.Add(status);
        Controls.Add(path);
        Controls.Add(name);
        WireClick(this);
        WireHover(this);
    }

    public void SetSelected(bool selected)
    {
        isSelected = selected;
        BackColor = selected ? Color.FromArgb(14, 70, 84) : Project.IsActive ? Color.FromArgb(8, 42, 55) : Color.FromArgb(15, 23, 42);
        Padding = selected ? new Padding(15, 10, 15, 7) : new Padding(16, 11, 16, 8);
        Invalidate();
    }

    protected override void OnPaintBackground(PaintEventArgs e) { }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var bounds = ClientRectangle;
        bounds.Width--;
        bounds.Height--;
        var fillColor = isSelected ? Color.FromArgb(13, 38, 54) : hovered ? Color.FromArgb(21, 32, 52) : Project.IsActive ? Color.FromArgb(10, 39, 54) : Color.FromArgb(15, 22, 41);
        using var path = LauncherShapes.RoundedRectangle(bounds, 12);
        using var fill = new SolidBrush(fillColor);
        using var border = new Pen(isSelected ? Color.FromArgb(37, 127, 148) : Project.IsActive ? Color.FromArgb(22, 110, 130) : Color.FromArgb(51, 65, 85));
        e.Graphics.FillPath(fill, path);
        e.Graphics.DrawPath(border, path);
        base.OnPaint(e);
    }

    private void WireClick(Control control)
    {
        control.Click += (_, _) => Clicked?.Invoke(this, EventArgs.Empty);
        foreach (Control child in control.Controls) WireClick(child);
    }

    private void WireHover(Control control)
    {
        control.MouseEnter += (_, _) => { hovered = true; Invalidate(); };
        control.MouseLeave += (_, _) => { hovered = ClientRectangle.Contains(PointToClient(Cursor.Position)); Invalidate(); };
        foreach (Control child in control.Controls) WireHover(child);
    }
}

internal sealed class WebProjectLinkForm : Form
{
    private const int WindowNcLeftButtonDown = 0x00A1;
    private const int HitCaption = 2;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

    private readonly List<ProjectCandidate> projects = new();
    private readonly string userDataFolder;
    private readonly string webRoot;
    private readonly Panel nativeChrome;
    private WebView2? webView;
    private bool initialized;
    private bool documentReady;
    private string launcherStatus = "Finding active and recent UEFN projects…";

    public ProjectCandidate? SelectedProject { get; private set; }

    public WebProjectLinkForm()
    {
        Text = "UEFN Entitlement Manager — Link project";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(960, 720);
        MinimumSize = new Size(820, 620);
        FormBorderStyle = FormBorderStyle.None;
        BackColor = Color.FromArgb(8, 12, 20);
        Padding = new Padding(1);
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? System.Drawing.SystemIcons.Application;
        ShowIcon = true;
        ShowInTaskbar = true;
        userDataFolder = Path.Combine(Path.GetTempPath(), "UEFN Entitlement Manager", "LauncherWebView2", Process.GetCurrentProcess().Id.ToString());
        webRoot = Path.Combine(userDataFolder, "web");
        nativeChrome = new Panel { Dock = DockStyle.Top, Height = 32, BackColor = Color.FromArgb(8, 13, 25) };
        nativeChrome.MouseDown += (_, eventArgs) =>
        {
            if (eventArgs.Button != MouseButtons.Left) return;
            ReleaseCapture();
            SendMessage(Handle, WindowNcLeftButtonDown, (IntPtr)HitCaption, IntPtr.Zero);
        };
        nativeChrome.DoubleClick += (_, _) => ToggleMaximized();
        var minimize = new Button { Text = "−", Dock = DockStyle.Right, Width = 40, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(8, 13, 25), ForeColor = Color.FromArgb(148, 163, 184), FlatAppearance = { BorderSize = 0 } };
        minimize.Click += (_, _) => WindowState = FormWindowState.Minimized;
        var maximize = new Button { Text = "□", Dock = DockStyle.Right, Width = 40, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(8, 13, 25), ForeColor = Color.FromArgb(148, 163, 184), FlatAppearance = { BorderSize = 0 } };
        maximize.Click += (_, _) => ToggleMaximized();
        var close = new Button { Text = "×", Dock = DockStyle.Right, Width = 42, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(8, 13, 25), ForeColor = Color.FromArgb(251, 113, 133), FlatAppearance = { BorderSize = 0 } };
        close.Click += (_, _) => Close();
        nativeChrome.Controls.Add(minimize);
        nativeChrome.Controls.Add(maximize);
        nativeChrome.Controls.Add(close);
        Controls.Add(nativeChrome);
        ClientSizeChanged += (_, _) => LayoutWebView();
    }

    protected override async void OnShown(EventArgs eventArgs)
    {
        base.OnShown(eventArgs);
        if (initialized) return;
        initialized = true;
        try
        {
            Directory.CreateDirectory(userDataFolder);
            Directory.CreateDirectory(webRoot);
            foreach (var fileName in new[] { "launcher.html", "uem-icon.svg", "adept-insignia.png" })
                File.Copy(Path.Combine(AppContext.BaseDirectory, fileName), Path.Combine(webRoot, fileName), overwrite: true);
            webView = new WebView2();
            Controls.Add(webView);
            Controls.SetChildIndex(nativeChrome, 0);
            LayoutWebView();
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
            await webView.EnsureCoreWebView2Async(environment);
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            webView.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
            webView.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
            webView.CoreWebView2.Settings.IsWebMessageEnabled = true;
            webView.CoreWebView2.WebMessageReceived += OnLauncherWebMessageReceived;
            webView.CoreWebView2.NavigationCompleted += OnLauncherNavigationCompleted;
            await RenderPageAsync();
            await LoadProjectsAsync();
            await PushStateAsync();
        }
        catch (Exception error)
        {
            DesktopDiagnostics.Append($"Web launcher initialization failed: {error}");
            MessageBox.Show(this, "The project launcher could not initialize its built-in web surface.\n\n" + error.Message, "UEFN Entitlement Manager", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private async Task LoadProjectsAsync()
    {
        var started = Stopwatch.StartNew();
        try
        {
            var discovered = await Task.Run(ProjectDiscovery.Discover);
            if (IsDisposed) return;
            projects.Clear();
            projects.AddRange(discovered);
            var active = projects.FirstOrDefault(project => project.IsActive);
            if (active is not null) SelectedProject = active;
            var status = projects.Count == 0
                ? "No local projects were found. Browse to a .uefnproject file."
                : $"Found {projects.Count} projects in {started.ElapsedMilliseconds} ms. Active and recent projects appear first.";
            launcherStatus = status;
        }
        catch (Exception error)
        {
            DesktopDiagnostics.Append($"Background project discovery failed: {error}");
            launcherStatus = "Automatic discovery was unavailable. Browse to a .uefnproject file instead.";
        }
    }

    private void ToggleMaximized() => WindowState = WindowState == FormWindowState.Maximized
        ? FormWindowState.Normal
        : FormWindowState.Maximized;

    private void LayoutWebView()
    {
        if (webView is null) return;
        var left = Padding.Left;
        var top = Padding.Top + nativeChrome.Height;
        webView.Bounds = new Rectangle(
            left,
            top,
            Math.Max(0, ClientSize.Width - Padding.Horizontal),
            Math.Max(0, ClientSize.Height - top - Padding.Bottom));
    }

    private string SerializeState()
    {
        var selectedIndex = SelectedProject is null ? -1 : projects.IndexOf(SelectedProject);
        return new JavaScriptSerializer().Serialize(new
        {
            projects = projects.Select(project => new
            {
                name = project.Name,
                projectFile = project.ProjectFile,
                sourceLabel = project.SourceLabel,
                isActive = project.IsActive,
                pythonEnabled = project.PythonEnabled,
            }),
            selectedIndex,
            status = launcherStatus,
        });
    }

    private Task RenderPageAsync()
    {
        if (webView?.CoreWebView2 is null || IsDisposed) return Task.CompletedTask;
        documentReady = false;
        var document = File.ReadAllText(Path.Combine(webRoot, "launcher.html"), Encoding.UTF8)
            .Replace("src=\"uem-icon.svg\"", "src=\"data:image/svg+xml;base64," + Convert.ToBase64String(File.ReadAllBytes(Path.Combine(webRoot, "uem-icon.svg"))) + "\"")
            .Replace("src=\"adept-insignia.png\"", "src=\"data:image/png;base64," + Convert.ToBase64String(File.ReadAllBytes(Path.Combine(webRoot, "adept-insignia.png"))) + "\"");
        webView.CoreWebView2.NavigateToString(document);
        return Task.CompletedTask;
    }

    private Task PushStateAsync()
    {
        if (!documentReady || webView?.CoreWebView2 is null || IsDisposed) return Task.CompletedTask;
        webView.CoreWebView2.PostWebMessageAsJson(SerializeState());
        return Task.CompletedTask;
    }

    private async void OnLauncherNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs eventArgs)
    {
        if (!eventArgs.IsSuccess)
        {
            DesktopDiagnostics.Append($"Launcher document navigation failed: {eventArgs.WebErrorStatus}");
            return;
        }
        documentReady = true;
        await PushStateAsync();
    }

    private async void OnLauncherWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        if (!eventArgs.Source.StartsWith("about:blank", StringComparison.OrdinalIgnoreCase)) return;
        string message;
        try { message = eventArgs.TryGetWebMessageAsString(); }
        catch (Exception error)
        {
            DesktopDiagnostics.Append($"Launcher message rejected: {error.Message}");
            return;
        }
        if (message.Equals("ready", StringComparison.Ordinal))
        {
            documentReady = true;
            await PushStateAsync();
            return;
        }
        if (message.Equals("minimize", StringComparison.Ordinal)) { WindowState = FormWindowState.Minimized; return; }
        if (message.Equals("close", StringComparison.Ordinal)) { Close(); return; }
        if (message.Equals("open-adept", StringComparison.Ordinal))
        {
            try { Process.Start(new ProcessStartInfo("https://adeptinteractive.net") { UseShellExecute = true }); }
            catch (Exception error) { DesktopDiagnostics.Append($"ADEPT link could not open: {error.Message}"); }
            return;
        }
        if (message.Equals("browse", StringComparison.Ordinal)) { await BrowseForProjectAsync(); return; }
        if (message.Equals("continue", StringComparison.Ordinal) && SelectedProject is not null) { DialogResult = DialogResult.OK; return; }
        if (message.StartsWith("select:", StringComparison.Ordinal) && int.TryParse(message.Substring("select:".Length), out var index) && index >= 0 && index < projects.Count)
        {
            SelectedProject = projects[index];
            launcherStatus = $"Found {projects.Count} projects. Active and recent projects appear first.";
            await PushStateAsync();
        }
    }

    private async Task BrowseForProjectAsync()
    {
        using var dialog = new OpenFileDialog
        {
            Filter = "UEFN project (*.uefnproject)|*.uefnproject",
            Title = "Link a UEFN project",
            CheckFileExists = true,
            Multiselect = false,
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        var project = ProjectDiscovery.ReadProject(dialog.FileName, ProjectSource.Browse, isActive: false);
        if (project is null)
        {
            launcherStatus = "Project could not be linked. Choose a .uefnproject file with an accessible Content directory.";
            await PushStateAsync();
            return;
        }
        projects.RemoveAll(candidate => candidate.ProjectFile.Equals(project.ProjectFile, StringComparison.OrdinalIgnoreCase));
        projects.Insert(0, project);
        SelectedProject = project;
        launcherStatus = "Selected project is ready to open in UEM.";
        await PushStateAsync();
    }

    protected override void OnFormClosed(FormClosedEventArgs eventArgs)
    {
        if (webView is not null)
        {
            if (webView.CoreWebView2 is not null)
            {
                webView.CoreWebView2.NavigationCompleted -= OnLauncherNavigationCompleted;
                webView.CoreWebView2.WebMessageReceived -= OnLauncherWebMessageReceived;
            }
            webView.CoreWebView2?.Stop();
            webView.Dispose();
            webView = null;
        }
        try { if (Directory.Exists(userDataFolder)) Directory.Delete(userDataFolder, recursive: true); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { DesktopDiagnostics.Append($"Launcher WebView cleanup failed: {error.Message}"); }
        base.OnFormClosed(eventArgs);
    }
}

internal sealed class AutoConnectorInstallResult
{
    public bool Installed { get; set; }
    public bool AddedThisLaunch { get; set; }
}

internal static class AutoConnectorInstaller
{
    private const string BeginMarker = "# UEM_AUTO_CONNECTOR_BEGIN";
    private const string EndMarker = "# UEM_AUTO_CONNECTOR_END";

    public static AutoConnectorInstallResult Install(string toolRoot, ProjectCandidate project)
    {
        var source = Path.Combine(toolRoot, "uefn_auto_connector.py");
        if (!File.Exists(source)) return new AutoConnectorInstallResult();
        var pythonDirectory = Path.Combine(project.ContentDirectory, "Python");
        Directory.CreateDirectory(pythonDirectory);
        var modulePath = Path.Combine(pythonDirectory, "uefn_auto_connector.py");
        File.Copy(source, modulePath, overwrite: true);

        var initPath = Path.Combine(pythonDirectory, "init_unreal.py");
        var existing = File.Exists(initPath) ? File.ReadAllText(initPath) : string.Empty;
        var alreadyInstalled = existing.Contains(BeginMarker) && existing.Contains(EndMarker);
        if (!alreadyInstalled)
        {
            if (File.Exists(initPath))
            {
                var backupDirectory = Path.Combine(pythonDirectory, ".uem-backups");
                Directory.CreateDirectory(backupDirectory);
                var backupPath = Path.Combine(backupDirectory, $"init_unreal.py.{DateTime.UtcNow:yyyyMMddTHHmmssfffZ}.bak");
                File.Copy(initPath, backupPath, overwrite: false);
            }
            var managedBlock = BeginMarker + Environment.NewLine
                + "try:" + Environment.NewLine
                + "    import uefn_auto_connector as _uem_auto_connector" + Environment.NewLine
                + "    _uem_auto_connector.install()" + Environment.NewLine
                + "except Exception as _uem_auto_connector_error:" + Environment.NewLine
                + "    import unreal as _uem_unreal" + Environment.NewLine
                + "    _uem_unreal.log_warning(f\"[EntitlementManager] Automatic connector startup failed: {_uem_auto_connector_error}\")" + Environment.NewLine
                + EndMarker + Environment.NewLine;
            var next = existing.TrimEnd() + (existing.Length == 0 ? string.Empty : Environment.NewLine + Environment.NewLine) + managedBlock;
            var temporary = initPath + $".{Process.GetCurrentProcess().Id}.tmp";
            File.WriteAllText(temporary, next);
            if (File.Exists(initPath)) File.Delete(initPath);
            File.Move(temporary, initPath);
        }

        return new AutoConnectorInstallResult
        {
            Installed = true,
            AddedThisLaunch = !alreadyInstalled,
        };
    }
}

internal static class EditorBootstrap
{
    private const int InputKeyboard = 1;
    private const uint KeyEventKeyUp = 0x0002;
    private const uint KeyEventUnicode = 0x0004;
    private const ushort VirtualKeyConsole = 0xC0;
    private const ushort VirtualKeyReturn = 0x0D;
    private const int ShowRestore = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public IntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int X;
        public int Y;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public IntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MouseInput Mouse;
        [FieldOffset(0)] public KeyboardInput Keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public int Type;
        public InputUnion Data;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint inputCount, Input[] inputs, int inputSize);

    public static void Begin(int port, string sessionToken, string projectFile, int processId)
    {
        Task.Run(async () =>
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(1) };
                client.DefaultRequestHeaders.TryAddWithoutValidation("X-UEM-Token", sessionToken);
                for (var attempt = 0; attempt < 8; attempt++)
                {
                    if (await EditorIsConnected(client, port)) return;
                    await Task.Delay(500);
                }

                using var editor = Process.GetProcessById(processId);
                if (editor.HasExited || !ProjectDiscovery.IsProjectOpenInUefn(projectFile)) return;
                await Report(client, port, "attempting");
                if (!SendConnectorCommand(editor, "import uefn_auto_connector; uefn_auto_connector.install()"))
                {
                    await Report(client, port, "failed", "The verified UEFN window could not accept the automatic connector command.");
                    return;
                }

                for (var attempt = 0; attempt < 8; attempt++)
                {
                    await Task.Delay(500);
                    if (await EditorIsConnected(client, port))
                    {
                        await Report(client, port, "connected");
                        return;
                    }
                }
                if (!SendConnectorCommand(editor, "py import uefn_auto_connector; uefn_auto_connector.install()"))
                {
                    await Report(client, port, "failed", "The verified UEFN console did not accept either supported connector command form.");
                    return;
                }
                for (var attempt = 0; attempt < 16; attempt++)
                {
                    await Task.Delay(500);
                    if (await EditorIsConnected(client, port))
                    {
                        await Report(client, port, "connected");
                        return;
                    }
                }
                await Report(client, port, "failed", "UEFN did not confirm the connector handshake after the automatic command.");
            }
            catch (Exception error) when (error is HttpRequestException or TaskCanceledException or InvalidOperationException or ArgumentException)
            {
                DesktopDiagnostics.Append($"Automatic UEFN connector bootstrap did not complete: {error.Message}");
            }
        });
    }

    private static async Task<bool> EditorIsConnected(HttpClient client, int port)
    {
        try
        {
            var status = await client.GetStringAsync($"http://127.0.0.1:{port}/api/editor/status");
            return Regex.IsMatch(status, "\\\"editorConnected\\\"\\s*:\\s*true", RegexOptions.IgnoreCase);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            return false;
        }
    }

    private static async Task Report(HttpClient client, int port, string state, string? message = null)
    {
        try
        {
            var json = "{\"state\":\"" + state + "\"" + (message is null ? string.Empty : ",\"message\":\"" + JsonEscape(message) + "\"") + "}";
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            using var response = await client.PostAsync($"http://127.0.0.1:{port}/api/editor/bootstrap-status", content);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            DesktopDiagnostics.Append($"Automatic connector status could not be reported: {error.Message}");
        }
    }

    private static bool SendConnectorCommand(Process editor, string command)
    {
        editor.Refresh();
        var editorWindow = editor.MainWindowHandle;
        if (editorWindow == IntPtr.Zero) return false;
        var previousWindow = GetForegroundWindow();
        try
        {
            ShowWindow(editorWindow, ShowRestore);
            if (!SetForegroundWindow(editorWindow)) return false;
            Thread.Sleep(250);
            if (GetForegroundWindow() != editorWindow) return false;
            SendVirtualKey(VirtualKeyConsole);
            Thread.Sleep(200);
            SendUnicode(command);
            SendVirtualKey(VirtualKeyReturn);
            return true;
        }
        finally
        {
            Thread.Sleep(150);
            if (previousWindow != IntPtr.Zero && previousWindow != editorWindow) SetForegroundWindow(previousWindow);
        }
    }

    private static void SendVirtualKey(ushort virtualKey)
    {
        var inputs = new[]
        {
            Keyboard(virtualKey, 0, 0),
            Keyboard(virtualKey, 0, KeyEventKeyUp),
        };
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input))) != (uint)inputs.Length)
            throw new InvalidOperationException("Windows did not deliver the automatic UEFN connector keystroke.");
    }

    private static void SendUnicode(string text)
    {
        var inputs = text.SelectMany(character => new[]
        {
            Keyboard(0, (ushort)character, KeyEventUnicode),
            Keyboard(0, (ushort)character, KeyEventUnicode | KeyEventKeyUp),
        }).ToArray();
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input))) != (uint)inputs.Length)
            throw new InvalidOperationException("Windows did not deliver the automatic UEFN connector command.");
    }

    private static Input Keyboard(ushort virtualKey, ushort scanCode, uint flags) => new()
    {
        Type = InputKeyboard,
        Data = new InputUnion { Keyboard = new KeyboardInput { VirtualKey = virtualKey, ScanCode = scanCode, Flags = flags } },
    };

    private static string JsonEscape(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");
}

internal sealed class BridgeSession : IDisposable
{
    private readonly Process process;
    private readonly string token;
    private readonly string editorToken;
    private readonly string logPath;
    private readonly string editorSessionPath;
    private bool disposed;

    public Uri AppUri { get; }

    private BridgeSession(Process process, Uri appUri, string token, string editorToken, string logPath, string editorSessionPath)
    {
        this.process = process;
        AppUri = appUri;
        this.token = token;
        this.editorToken = editorToken;
        this.logPath = logPath;
        this.editorSessionPath = editorSessionPath;
    }

    public static BridgeSession Start(ProjectCandidate project)
    {
        var toolRoot = FindToolRoot();
        var serverPath = Path.Combine(toolRoot, "dist", "server.cjs");
        if (!File.Exists(serverPath)) throw new FileNotFoundException("The manager bridge build is missing.", serverPath);
        var nodePath = FindNode(toolRoot);
        AutoConnectorInstallResult autoConnector;
        try { autoConnector = AutoConnectorInstaller.Install(toolRoot, project); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            DesktopDiagnostics.Append($"Automatic UEFN connector installation failed: {error}");
            autoConnector = new AutoConnectorInstallResult();
        }
        var port = ReserveLoopbackPort();
        var token = CreateToken();
        var editorToken = CreateToken();
        using var openUefnProcess = ProjectDiscovery.FindOpenProjectProcess(project.ProjectFile);
        var openUefnProcessId = openUefnProcess?.Id ?? 0;
        var logRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UEFN Entitlement Manager", "logs");
        Directory.CreateDirectory(logRoot);
        var logPath = Path.Combine(logRoot, $"bridge-startup-{port}.log");

        var startInfo = new ProcessStartInfo
        {
            FileName = nodePath,
            Arguments = $"\"{serverPath}\"",
            WorkingDirectory = toolRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        startInfo.EnvironmentVariables["PORT"] = port.ToString();
        startInfo.EnvironmentVariables["UEM_SESSION_TOKEN"] = token;
        startInfo.EnvironmentVariables["UEM_EDITOR_TOKEN"] = editorToken;
        startInfo.EnvironmentVariables["UEM_CONTENT_ROOT"] = project.ContentDirectory;
        startInfo.EnvironmentVariables["UEM_ASSET_MOUNT"] = "/" + project.AssetMount;
        startInfo.EnvironmentVariables["UEM_PROJECT_FILE"] = project.ProjectFile;
        startInfo.EnvironmentVariables["UEM_PROJECT_PYTHON_ENABLED"] = project.PythonEnabled ? "1" : "0";
        startInfo.EnvironmentVariables["UEM_AUTO_CONNECTOR_INSTALLED"] = autoConnector.Installed ? "1" : "0";
        startInfo.EnvironmentVariables["UEM_UEFN_PROCESS_ID"] = openUefnProcessId.ToString();
        startInfo.EnvironmentVariables["UEM_BOOTSTRAP_ELIGIBLE"] = openUefnProcessId > 0 && project.PythonEnabled && autoConnector.Installed ? "1" : "0";
        startInfo.EnvironmentVariables["UEM_IDLE_TIMEOUT_MS"] = "120000";

        var bridge = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        var logLock = new object();
        DataReceivedEventHandler appendLog = (_, eventArgs) =>
        {
            if (eventArgs.Data is null) return;
            lock (logLock) File.AppendAllText(logPath, eventArgs.Data + Environment.NewLine);
        };
        bridge.OutputDataReceived += appendLog;
        bridge.ErrorDataReceived += appendLog;
        if (!bridge.Start()) throw new InvalidOperationException("The secure project bridge could not be started.");
        bridge.BeginOutputReadLine();
        bridge.BeginErrorReadLine();

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(1) };
            var healthy = false;
            for (var attempt = 0; attempt < 40; attempt++)
            {
                if (bridge.HasExited) break;
                try
                {
                    var health = client.GetStringAsync($"http://127.0.0.1:{port}/api/health").GetAwaiter().GetResult();
                    if (health.Contains("UEFN Entitlement Manager Bridge")) { healthy = true; break; }
                }
                catch (Exception error) when (error is HttpRequestException or TaskCanceledException) { }
                Thread.Sleep(250);
            }
            if (!healthy)
            {
                var output = File.Exists(logPath) ? File.ReadAllText(logPath) : "Bridge log unavailable.";
                throw new InvalidOperationException($"The secure project bridge did not start.\n\n{output}");
            }

            var fragment = "token=" + Uri.EscapeDataString(token)
                + "&contentDir=" + Uri.EscapeDataString(project.ContentDirectory)
                + "&assetFolder=EntitlementIcons&verseFile=managed_transactions.verse"
                + "&pythonEnabled=" + (project.PythonEnabled ? "true" : "false");
            var editorSessionPath = WriteEditorSessionFile(port, editorToken, project, Path.Combine(toolRoot, "entitlement_manager.py"));
            if (openUefnProcessId > 0 && project.PythonEnabled && autoConnector.Installed)
                EditorBootstrap.Begin(port, token, project.ProjectFile, openUefnProcessId);
            return new BridgeSession(bridge, new Uri($"http://127.0.0.1:{port}/#{fragment}"), token, editorToken, logPath, editorSessionPath);
        }
        catch
        {
            if (!bridge.HasExited) bridge.Kill();
            bridge.Dispose();
            throw;
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        try
        {
            if (!process.HasExited)
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
                using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(AppUri, "/api/session/shutdown"));
                request.Headers.TryAddWithoutValidation("X-UEM-Token", token);
                client.SendAsync(request).GetAwaiter().GetResult().Dispose();
                if (!process.WaitForExit(3000)) process.Kill();
            }
        }
        catch (Exception error)
        {
            DesktopDiagnostics.Append($"Owned bridge shutdown failed ({logPath}): {error.Message}");
            try { if (!process.HasExited) process.Kill(); } catch { }
        }
        TryDeleteEditorSessionFile();
        process.Dispose();
    }

    private static string FindToolRoot()
    {
        foreach (var seed in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            var current = new DirectoryInfo(seed);
            for (var depth = 0; current is not null && depth < 7; depth++)
            {
                if (File.Exists(Path.Combine(current.FullName, "dist", "server.cjs"))) return current.FullName;
                current = current.Parent;
            }
        }
        throw new DirectoryNotFoundException("The manager's dist/server.cjs bridge could not be located. Keep the extracted release folder intact.");
    }

    private static string FindNode(string toolRoot)
    {
        var runtimeRoot = Path.Combine(toolRoot, ".runtime");
        if (Directory.Exists(runtimeRoot))
        {
            foreach (var runtime in Directory.GetDirectories(runtimeRoot, "node-*", SearchOption.TopDirectoryOnly).OrderByDescending(path => path))
            {
                var bundled = Path.Combine(runtime, "node.exe");
                if (File.Exists(bundled)) return bundled;
            }
        }
        foreach (var candidate in new[]
                 {
                     Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                     Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
                 })
            if (File.Exists(candidate)) return candidate;
        throw new FileNotFoundException("A bundled or system Node.js runtime could not be found.");
    }

    private static int ReserveLoopbackPort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try { return ((IPEndPoint)listener.LocalEndpoint).Port; }
        finally { listener.Stop(); }
    }

    private static string CreateToken()
    {
        var bytes = new byte[48];
        using var random = RandomNumberGenerator.Create();
        random.GetBytes(bytes);
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static string WriteEditorSessionFile(int port, string editorToken, ProjectCandidate project, string connectorScript)
    {
        var stateRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UEFN Entitlement Manager");
        Directory.CreateDirectory(stateRoot);
        var statePath = Path.Combine(stateRoot, "active-session.json");
        var temporaryPath = statePath + "." + Process.GetCurrentProcess().Id + ".tmp";
        var json = "{\n"
            + "  \"schemaVersion\": 1,\n"
            + $"  \"desktopProcessId\": {Process.GetCurrentProcess().Id},\n"
            + $"  \"port\": {port},\n"
            + $"  \"editorToken\": \"{JsonEscape(editorToken)}\",\n"
            + $"  \"contentRoot\": \"{JsonEscape(project.ContentDirectory)}\",\n"
            + $"  \"assetMount\": \"/{JsonEscape(project.AssetMount)}\",\n"
            + $"  \"projectFile\": \"{JsonEscape(project.ProjectFile)}\",\n"
            + $"  \"connectorScript\": \"{JsonEscape(connectorScript)}\"\n"
            + "}\n";
        File.WriteAllText(temporaryPath, json);
        if (File.Exists(statePath)) File.Delete(statePath);
        File.Move(temporaryPath, statePath);
        return statePath;
    }

    private void TryDeleteEditorSessionFile()
    {
        try
        {
            if (!File.Exists(editorSessionPath)) return;
            var current = File.ReadAllText(editorSessionPath);
            if (current.Contains("\"editorToken\": \"" + JsonEscape(editorToken) + "\"")) File.Delete(editorSessionPath);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            DesktopDiagnostics.Append($"Editor connector session cleanup failed: {error.Message}");
        }
    }

    private static string JsonEscape(string value) => value
        .Replace("\\", "\\\\")
        .Replace("\"", "\\\"")
        .Replace("\r", "\\r")
        .Replace("\n", "\\n");
}
