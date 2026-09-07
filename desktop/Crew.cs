using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Crew")]
[assembly: AssemblyDescription("Your personal ChatGPT-powered workspace")]
[assembly: AssemblyCompany("Crew Local")]
[assembly: AssemblyProduct("Crew")]
[assembly: AssemblyVersion("0.6.1.0")]
[assembly: AssemblyFileVersion("0.6.1.0")]

namespace CrewDesktop
{
    internal static class Program
    {
        internal const string HomeUrl = "http://127.0.0.1:4318/";
        internal static readonly string DesktopRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        internal static string CrewRoot = Path.GetFullPath(Path.Combine(DesktopRoot, ".."));
        internal static int ExitCode;

        [STAThread]
        private static int Main(string[] args)
        {
            // A staged executable can inspect the real package without being
            // installed over a running desktop. This override is diagnostics-only.
            if (args.Length == 4 && args[0] == "--self-test" && args[2] == "--package-root")
            {
                CrewRoot = Path.GetFullPath(args[3]);
                return SelfTest(args[1]);
            }
            if (args.Length == 2 && args[0] == "--self-test") return SelfTest(args[1]);
            string smokeReport = args.Length == 2 && args[0] == "--smoke-test" ? Path.GetFullPath(args[1]) : null;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs e) { Log("UI error", e.Exception); };

            string instance = "Local\\CrewDesktop-" + RootIdentity();
            bool first;
            using (Mutex mutex = new Mutex(true, instance, out first))
            using (EventWaitHandle open = new EventWaitHandle(false, EventResetMode.AutoReset, instance + "-Open"))
            {
                if (!first && smokeReport == null) { open.Set(); return 0; }
                using (CrewWindow window = new CrewWindow(smokeReport))
                {
                    RegisteredWaitHandle registration = ThreadPool.RegisterWaitForSingleObject(open, delegate
                    {
                        if (window.IsHandleCreated && !window.IsDisposed)
                            try { window.BeginInvoke(new Action(window.OpenWindow)); } catch (InvalidOperationException) { }
                    }, null, Timeout.Infinite, false);
                    try { Application.Run(window); }
                    finally { registration.Unregister(null); }
                }
                if (first) mutex.ReleaseMutex();
            }
            return ExitCode;
        }

        internal static string RootIdentity()
        {
            using (SHA256 hash = SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(CrewRoot.ToLowerInvariant()))).Replace("-", "").Substring(0, 16);
        }

        internal static void Log(string context, Exception error)
        {
            try { File.AppendAllText(Path.Combine(DesktopRoot, "desktop.log"), DateTime.UtcNow.ToString("o") + " " + context + ": " + error.Message + Environment.NewLine); }
            catch (IOException) { } catch (UnauthorizedAccessException) { }
        }

        internal static void WriteReport(string path, object report)
        {
            string directory = Path.GetDirectoryName(Path.GetFullPath(path));
            Directory.CreateDirectory(directory);
            File.WriteAllText(path, new JavaScriptSerializer().Serialize(report), new UTF8Encoding(false));
        }

        private static int SelfTest(string reportPath)
        {
            try
            {
                string[] allowed = { HomeUrl, HomeUrl + "?panel=routines", HomeUrl + "api/file?id=test", "blob:" + HomeUrl + "owned-file" };
                string[] blocked = { "https://example.com/", "http://127.0.0.1:4319/", "http://localhost:4318/", "http://127.0.0.1.evil.test:4318/", "http://user@127.0.0.1:4318/", "file:///C:/Windows/win.ini", "javascript:alert(1)", "data:text/html,test", "blob:https://example.com/test", "https://127.0.0.1:4318/" };
                foreach (string url in allowed) if (!NavigationPolicy.IsCrewResource(url)) throw new Exception("Allowed URL rejected: " + url);
                foreach (string url in blocked) if (NavigationPolicy.IsCrewResource(url)) throw new Exception("Blocked URL accepted: " + url);
                string fixture = "<title>Crew</title><div id=\"app\"></div><script>window.CREW_TOKEN='" + new string('a', 64) + "';</script><script type=\"module\" src=\"/app.js\"></script>";
                if (!ServerBootstrap.IsCrewHtml(fixture) || ServerBootstrap.IsCrewHtml("<title>Crew</title>Not the app")) throw new Exception("Crew identity check failed");
                string runtime = CoreWebView2Environment.GetAvailableBrowserVersionString();
                string node = ServerBootstrap.FindNode();
                if (node == null) throw new FileNotFoundException("Crew's Node runtime is missing. Run Setup.ps1 or restore the complete package.");
                string codex = ServerBootstrap.FindCodex(), bundledCodex = Path.Combine(CrewRoot, "runtime", "codex", "codex.exe");
                if (codex == null) throw new FileNotFoundException("Crew's bundled engine is missing. Restore the complete Crew package, including runtime/codex.");
                bool bundledEngine = String.Equals(codex, bundledCodex, StringComparison.OrdinalIgnoreCase);
                if (File.Exists(bundledCodex) && !bundledEngine) throw new Exception("The packaged Codex engine must take precedence over developer or installed copies.");
                bool? listener = ServerBootstrap.HasListener(); Stopwatch probeTime = Stopwatch.StartNew(); ServerState serverState = ServerBootstrap.Probe(); probeTime.Stop();
                if (listener == false && serverState != ServerState.Unavailable) throw new Exception("A port without a listener must be classified as unavailable.");
                WriteReport(reportPath, new { passed = true, navigationCases = allowed.Length + blocked.Length, crewHtmlIdentity = true, webViewRuntime = runtime, node = ServerBootstrap.FindNode(), codex = codex, bundledEngine = bundledEngine, codexDesktopRequired = false, root = CrewRoot, data = Path.Combine(CrewRoot, "data"), server = serverState.ToString(), listenerPresent = listener, probeMilliseconds = probeTime.ElapsedMilliseconds, processSubsystem = "Windows GUI", version = "0.6.1" });
                return 0;
            }
            catch (Exception error) { WriteReport(reportPath, new { passed = false, error = error.Message }); return 1; }
        }
    }

    internal static class NavigationPolicy
    {
        internal static bool IsCrewOrigin(string text)
        {
            Uri uri;
            return Uri.TryCreate(text, UriKind.Absolute, out uri) && uri.Scheme == Uri.UriSchemeHttp && uri.Host == "127.0.0.1" && uri.Port == 4318 && String.IsNullOrEmpty(uri.UserInfo);
        }

        internal static bool IsCrewResource(string text)
        {
            if (String.IsNullOrEmpty(text)) return false;
            return IsCrewOrigin(text) || (text.StartsWith("blob:", StringComparison.OrdinalIgnoreCase) && IsCrewOrigin(text.Substring(5)));
        }

        internal static bool IsExternalWebLink(string text)
        {
            Uri uri;
            return Uri.TryCreate(text, UriKind.Absolute, out uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) && String.IsNullOrEmpty(uri.UserInfo) && !IsCrewOrigin(text);
        }

        internal static void OpenExternal(string text)
        {
            if (!IsExternalWebLink(text)) return;
            try { Process.Start(new ProcessStartInfo(text) { UseShellExecute = true }); }
            catch (Exception error) { Program.Log("Could not open link", error); }
        }
    }

    internal enum ServerState { Unavailable, Crew, Occupied, Pending }

    internal static class ServerBootstrap
    {
        internal static bool? HasListener()
        {
            try
            {
                foreach (IPEndPoint endpoint in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners())
                    if (endpoint.Port == 4318 && (endpoint.Address.Equals(IPAddress.Loopback) || endpoint.Address.Equals(IPAddress.Any) || endpoint.Address.Equals(IPAddress.IPv6Any))) return true;
                return false;
            }
            catch (NetworkInformationException) { return null; }
            catch (System.Security.SecurityException) { return null; }
        }

        internal static bool IsCrewHtml(string html)
        {
            return html.IndexOf("<title>Crew</title>", StringComparison.OrdinalIgnoreCase) >= 0
                && html.IndexOf("id=\"app\"", StringComparison.Ordinal) >= 0
                && html.IndexOf("src=\"/app.js\"", StringComparison.Ordinal) >= 0
                && Regex.IsMatch(html, "window\\.CREW_TOKEN\\s*=\\s*['\"][a-f0-9]{64}['\"]", RegexOptions.IgnoreCase);
        }

        private static Dictionary<string, object> ReadHealth()
        {
            try
            {
                HttpWebRequest health = (HttpWebRequest)WebRequest.Create(Program.HomeUrl + "health");
                health.Proxy = null; health.AllowAutoRedirect = false; health.Timeout = 1500; health.ReadWriteTimeout = 1500;
                using (HttpWebResponse response = (HttpWebResponse)health.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                {
                    char[] buffer = new char[4096]; int count = reader.ReadBlock(buffer, 0, buffer.Length);
                    if (response.StatusCode == HttpStatusCode.OK && response.ContentType.StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
                    {
                        Dictionary<string, object> data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(new string(buffer, 0, count));
                        if (data != null && data.ContainsKey("app") && Object.Equals(data["app"], "Crew") && data.ContainsKey("version") && Convert.ToInt32(data["version"]) >= 4 && data.ContainsKey("pid") && Convert.ToInt32(data["pid"]) > 0) return data;
                    }
                }
            }
            catch (WebException error) { if (error.Response != null) error.Response.Dispose(); }
            catch (ArgumentException) { } catch (InvalidOperationException) { } catch (FormatException) { } catch (OverflowException) { }
            return null;
        }

        internal static ServerState Probe()
        {
            // .NET's HTTP stack can time out rather than immediately returning
            // ConnectFailure for a recently closed port. The TCP listener table
            // identifies the cold-start case before any HTTP request is made.
            if (HasListener() == false) return ServerState.Unavailable;
            // Version 4 exposes an explicit identity endpoint. The HTML check
            // below remains compatible with an already-running Crew 3 server.
            if (ReadHealth() != null) return ServerState.Crew;
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Program.HomeUrl);
                request.Proxy = null; request.AllowAutoRedirect = false; request.Timeout = 2000; request.ReadWriteTimeout = 2000;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    if (response.StatusCode != HttpStatusCode.OK || !response.ContentType.StartsWith("text/html", StringComparison.OrdinalIgnoreCase)) return ServerState.Occupied;
                    using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                    {
                        char[] buffer = new char[262144]; int length = 0, count;
                        while (length < buffer.Length && (count = reader.Read(buffer, length, buffer.Length - length)) > 0) length += count;
                        return IsCrewHtml(new string(buffer, 0, length)) ? ServerState.Crew : ServerState.Occupied;
                    }
                }
            }
            catch (WebException error)
            {
                if (error.Response != null) { error.Response.Dispose(); return ServerState.Occupied; }
                // A timeout is not evidence of another app's identity. Wait for
                // a starting/stopping listener rather than launch a second host.
                return HasListener() == false ? ServerState.Unavailable : ServerState.Pending;
            }
        }

        internal static void Shutdown()
        {
            if (Probe() == ServerState.Unavailable) return;
            if (ReadHealth() == null) throw new InvalidOperationException("This server does not support desktop shutdown. Reopen the updated Crew app first. The background server is still running.");
            string token;
            HttpWebRequest pageRequest = (HttpWebRequest)WebRequest.Create(Program.HomeUrl);
            pageRequest.Proxy = null; pageRequest.AllowAutoRedirect = false; pageRequest.Timeout = 3000; pageRequest.ReadWriteTimeout = 3000;
            using (HttpWebResponse response = (HttpWebResponse)pageRequest.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
            {
                char[] buffer = new char[262144]; int count = reader.ReadBlock(buffer, 0, buffer.Length);
                string html = new string(buffer, 0, count);
                if (response.StatusCode != HttpStatusCode.OK || !ServerBootstrap.IsCrewHtml(html)) throw new InvalidOperationException("The local server did not return the Crew app. No shutdown was sent.");
                token = Regex.Match(html, "window\\.CREW_TOKEN\\s*=\\s*['\"]([a-f0-9]{64})['\"]", RegexOptions.IgnoreCase).Groups[1].Value;
            }
            HttpWebRequest shutdown = (HttpWebRequest)WebRequest.Create(Program.HomeUrl + "api/shutdown");
            shutdown.Proxy = null; shutdown.AllowAutoRedirect = false; shutdown.Timeout = 5000; shutdown.ReadWriteTimeout = 5000;
            shutdown.Method = "POST"; shutdown.ContentType = "application/json"; shutdown.ContentLength = 2;
            shutdown.Headers["X-Crew-Token"] = token;
            using (Stream body = shutdown.GetRequestStream()) { byte[] bytes = Encoding.UTF8.GetBytes("{}"); body.Write(bytes, 0, bytes.Length); }
            using (HttpWebResponse response = (HttpWebResponse)shutdown.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
            {
                char[] buffer = new char[4096]; int count = reader.ReadBlock(buffer, 0, buffer.Length);
                Dictionary<string, object> result = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(new string(buffer, 0, count));
                if (response.StatusCode != HttpStatusCode.OK || result == null || !result.ContainsKey("ok") || !Object.Equals(result["ok"], true)) throw new InvalidOperationException("The local server did not confirm shutdown.");
            }
            // Use the server's authenticated graceful shutdown. Never terminate
            // a PID learned from a port or kill another application's process.
        }

        private static string FromPath(string executable)
        {
            foreach (string item in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
            {
                try { string candidate = Path.Combine(item.Trim().Trim('"'), executable); if (Path.IsPathRooted(candidate) && File.Exists(candidate)) return Path.GetFullPath(candidate); }
                catch (ArgumentException) { } catch (NotSupportedException) { }
            }
            return null;
        }

        internal static string FindNode()
        {
            string bundled = Path.Combine(Program.CrewRoot, "runtime", "node.exe");
            if (File.Exists(bundled)) return bundled;
            return FromPath("node.exe");
        }

        internal static string FindCodex()
        {
            string bundled = Path.Combine(Program.CrewRoot, "runtime", "codex", "codex.exe");
            if (File.Exists(bundled)) return bundled;
            // Source/development builds may explicitly supply an engine. Normal
            // packages never depend on PATH or a Codex desktop installation.
            string development = Environment.GetEnvironmentVariable("CREW_CODEX_OVERRIDE");
            if (!String.IsNullOrWhiteSpace(development) && Path.IsPathRooted(development) && development.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(development)) return Path.GetFullPath(development);
            return null;
        }

        internal static string EnsureServer(bool existingOnly)
        {
            ServerState state = Probe();
            Stopwatch waiting = Stopwatch.StartNew();
            while (state == ServerState.Pending && waiting.ElapsedMilliseconds < 20000) { Thread.Sleep(300); state = Probe(); }
            if (state == ServerState.Crew) return "reused";
            if (state == ServerState.Occupied) throw new InvalidOperationException("Port 4318 is already in use or did not return the Crew app. Close the other service, then choose Retry.");
            if (state == ServerState.Pending) throw new TimeoutException("A local service is still starting or stopping on port 4318. No second server was started. Choose Retry in a moment.");
            if (existingOnly) throw new InvalidOperationException("The smoke test requires an already-running Crew server on port 4318.");
            string node = FindNode(), codex = FindCodex(), server = Path.Combine(Program.CrewRoot, "server.mjs");
            if (node == null) throw new FileNotFoundException("Crew's Node runtime is missing. Keep the runtime folder next to the Crew app files.");
            if (codex == null) throw new FileNotFoundException("Crew's bundled engine is missing. Restore the complete Crew package, including runtime/codex, then choose Retry.");
            if (!File.Exists(server)) throw new FileNotFoundException("Crew's server files are missing. Keep this desktop folder inside the complete Crew folder.");
            ProcessStartInfo start = new ProcessStartInfo(node, "\"" + server + "\"");
            start.WorkingDirectory = Program.CrewRoot;
            start.UseShellExecute = false; start.CreateNoWindow = true; start.WindowStyle = ProcessWindowStyle.Hidden;
            start.EnvironmentVariables["CREW_PORT"] = "4318";
            start.EnvironmentVariables["CREW_DATA"] = Path.Combine(Program.CrewRoot, "data");
            start.EnvironmentVariables["CREW_CODEX"] = codex;
            start.EnvironmentVariables["PATH"] = Path.GetDirectoryName(node) + Path.PathSeparator + Path.GetDirectoryName(codex) + Path.PathSeparator + (Environment.GetEnvironmentVariable("PATH") ?? "");
            // No redirected pipes: the independent server must survive desktop exit.
            using (Process process = Process.Start(start))
            {
                Stopwatch elapsed = Stopwatch.StartNew();
                while (elapsed.ElapsedMilliseconds < 20000)
                {
                    state = Probe();
                    if (state == ServerState.Crew) return "started";
                    if (process.HasExited) throw new InvalidOperationException("Crew's background server exited (code " + process.ExitCode + "). Check that the complete app and its dependencies are present.");
                    if (state == ServerState.Occupied) throw new InvalidOperationException("Port 4318 did not return the Crew app after startup.");
                    Thread.Sleep(300);
                }
            }
            throw new TimeoutException("Crew is taking longer than expected to start. Choose Retry in a moment.");
        }
    }

    internal sealed class CrewWindow : Form
    {
        private WebView2 browser = new WebView2();
        private readonly Panel loading = new Panel();
        private readonly Label status = new Label();
        private readonly Button retry = new Button();
        private readonly NotifyIcon tray = new NotifyIcon();
        private readonly string smokeReport;
        private bool quitting, initializing, smokeCaptured, explainedTray, recreateBrowser, quittingServer;
        private readonly System.Windows.Forms.Timer smokeTimeout = new System.Windows.Forms.Timer();
        private string serverMode;

        internal CrewWindow(string report)
        {
            smokeReport = report;
            Text = "Crew"; MinimumSize = new Size(900, 620); Size = new Size(1360, 900); StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi; BackColor = Color.FromArgb(250, 250, 249);
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            browser.Dock = DockStyle.Fill; browser.DefaultBackgroundColor = BackColor; browser.Visible = false;
            Controls.Add(browser);
            loading.Dock = DockStyle.Fill; loading.BackColor = BackColor; Controls.Add(loading);
            Label title = new Label { Text = "Crew", Font = new Font("Segoe UI", 25, FontStyle.Bold), AutoSize = true, Anchor = AnchorStyles.None };
            status.Font = new Font("Segoe UI", 11); status.ForeColor = Color.FromArgb(93, 93, 90); status.TextAlign = ContentAlignment.TopCenter; status.Size = new Size(620, 110); status.Text = "Opening your workspace…";
            retry.Text = "Retry"; retry.Size = new Size(104, 36); retry.Visible = false; retry.FlatStyle = FlatStyle.Flat;
            loading.Controls.Add(title); loading.Controls.Add(status); loading.Controls.Add(retry);
            loading.Resize += delegate { title.Location = new Point((loading.Width - title.Width) / 2, loading.Height / 2 - 105); status.Location = new Point((loading.Width - status.Width) / 2, loading.Height / 2 - 40); retry.Location = new Point((loading.Width - retry.Width) / 2, loading.Height / 2 + 84); };
            retry.Click += async delegate { await InitializeBrowser(); };
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("Open Crew", null, delegate { OpenWindow(); });
            menu.Items.Add("Reload", null, delegate { OpenWindow(); if (browser.CoreWebView2 != null) browser.Reload(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit Crew", null, async delegate { await QuitCrew(); });
            tray.Icon = Icon; tray.Text = "Crew — your workspace"; tray.ContextMenuStrip = menu; tray.Visible = report == null;
            tray.DoubleClick += delegate { OpenWindow(); };
            FormClosing += OnClosing;
            Shown += async delegate { await InitializeBrowser(); };
            if (report != null)
            {
                ShowInTaskbar = false; Opacity = 0;
                smokeTimeout.Interval = 30000;
                smokeTimeout.Tick += delegate { smokeTimeout.Stop(); Fail("The desktop smoke test timed out before the workspace rendered.", new TimeoutException()); };
                smokeTimeout.Start();
            }
        }

        internal void OpenWindow()
        {
            Show(); if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Activate();
        }

        private async Task QuitCrew()
        {
            if (quittingServer) return; quittingServer = true;
            try { await Task.Run(() => ServerBootstrap.Shutdown()); quitting = true; Close(); }
            catch (Exception error)
            {
                Program.Log("Shutdown", error);
                MessageBox.Show(this, "Crew could not be stopped.\n\n" + error.Message, "Crew", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            finally { quittingServer = false; }
        }

        private async Task InitializeBrowser()
        {
            if (initializing) return; initializing = true; retry.Visible = false; status.Text = "Opening your workspace…";
            try
            {
                CoreWebView2Environment.GetAvailableBrowserVersionString();
                serverMode = await Task.Run(() => ServerBootstrap.EnsureServer(smokeReport != null));
                if (recreateBrowser)
                {
                    Controls.Remove(browser); browser.Dispose(); browser = new WebView2();
                    browser.Dock = DockStyle.Fill; browser.DefaultBackgroundColor = BackColor; browser.Visible = false;
                    Controls.Add(browser); browser.SendToBack(); recreateBrowser = false;
                }
                if (browser.CoreWebView2 == null)
                {
                    string profile = Path.Combine(Program.DesktopRoot, "profile");
                    CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, profile, null);
                    await browser.EnsureCoreWebView2Async(environment);
                    ConfigureBrowser();
                }
                browser.CoreWebView2.Navigate(Program.HomeUrl);
            }
            catch (WebView2RuntimeNotFoundException error)
            {
                Fail("Microsoft Edge WebView2 Runtime is required. Install the Evergreen Runtime from Microsoft's WebView2 site, then choose Retry.", error);
            }
            catch (Exception error) { Fail(error.Message, error); }
            finally { initializing = false; }
        }

        private void ConfigureBrowser()
        {
            CoreWebView2 core = browser.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.IsWebMessageEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDefaultScriptDialogsEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e)
            {
                if (!NavigationPolicy.IsCrewResource(e.Uri)) { e.Cancel = true; if (e.IsUserInitiated) NavigationPolicy.OpenExternal(e.Uri); }
            };
            core.FrameNavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) { if (!NavigationPolicy.IsCrewResource(e.Uri)) e.Cancel = true; };
            core.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e)
            {
                e.Handled = true;
                if (!e.IsUserInitiated) return;
                if (NavigationPolicy.IsCrewOrigin(e.Uri)) core.Navigate(e.Uri); else NavigationPolicy.OpenExternal(e.Uri);
            };
            core.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) { e.State = CoreWebView2PermissionState.Deny; e.SavesInProfile = false; };
            core.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs e)
            {
                if (!NavigationPolicy.IsCrewResource(e.DownloadOperation.Uri)) { e.Cancel = true; return; }
                // Keep WebView2's normal download/save UI. Never choose a path,
                // overwrite a file, suppress its UI, or auto-open a download.
                e.Handled = false;
            };
            core.WindowCloseRequested += delegate { if (smokeReport == null) Hide(); };
            core.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs e)
            {
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) { recreateBrowser = true; Fail("The workspace browser stopped. Choose Retry to reopen it.", new Exception(e.ProcessFailedKind.ToString())); }
                else if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited) Fail("The workspace renderer stopped. Choose Retry to reopen it.", new Exception(e.ProcessFailedKind.ToString()));
                // GPU and utility-process exits are recovered by WebView2 itself.
            };
            core.NavigationCompleted += async delegate(object sender, CoreWebView2NavigationCompletedEventArgs e)
            {
                if (!e.IsSuccess) { if (e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled) Fail("Crew could not open the workspace. Choose Retry.", new Exception(e.WebErrorStatus.ToString())); return; }
                if (!NavigationPolicy.IsCrewOrigin(core.Source)) return;
                loading.Visible = false; browser.Visible = true;
                if (smokeReport != null && !smokeCaptured)
                {
                    smokeCaptured = true;
                    try
                    {
                        await Task.Delay(1200);
                        string json = await core.ExecuteScriptAsync("JSON.stringify({title:document.title,app:!!document.getElementById('app'),main:!!document.querySelector('main'),rendered:!!document.querySelector('#page .team-home'),tokenPresent:typeof window.CREW_TOKEN==='string'&&window.CREW_TOKEN.length===64,bodyVisible:document.body.innerText.length>20})");
                        JavaScriptSerializer serializer = new JavaScriptSerializer();
                        Dictionary<string, object> page = serializer.Deserialize<Dictionary<string, object>>(serializer.Deserialize<string>(json));
                        bool passed = (string)page["title"] == "Crew" && (bool)page["app"] && (bool)page["main"] && (bool)page["rendered"] && (bool)page["tokenPresent"] && (bool)page["bodyVisible"];
                        string screenshot = Path.ChangeExtension(smokeReport, ".png");
                        using (FileStream file = File.Create(screenshot)) await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, file);
                        Program.WriteReport(smokeReport, new { passed = passed, server = serverMode, source = core.Source, page = page, screenshot = screenshot, hostObjectsDisabled = !core.Settings.AreHostObjectsAllowed, webMessagesDisabled = !core.Settings.IsWebMessageEnabled, devToolsDisabled = !core.Settings.AreDevToolsEnabled, webViewRuntime = core.Environment.BrowserVersionString });
                        Program.ExitCode = passed ? 0 : 1;
                    }
                    catch (Exception error) { Program.WriteReport(smokeReport, new { passed = false, error = error.Message }); Program.ExitCode = 1; }
                    quitting = true; Close();
                }
            };
        }

        private void Fail(string message, Exception error)
        {
            Program.Log("Startup", error); loading.Visible = true; browser.Visible = false; status.Text = message; retry.Visible = true;
            if (smokeReport != null) { Program.WriteReport(smokeReport, new { passed = false, error = message }); Program.ExitCode = 1; quitting = true; Close(); }
        }

        private void OnClosing(object sender, FormClosingEventArgs e)
        {
            if (!quitting && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true; Hide();
                if (!explainedTray) { explainedTray = true; tray.ShowBalloonTip(3000, "Crew is still available", "Open Crew from this icon. Your routines and phone connection keep running.", ToolTipIcon.Info); }
                return;
            }
            // Closing the desktop must not stop the independent local server.
            tray.Visible = false;
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.F5 || keyData == (Keys.Control | Keys.R)) { if (browser.CoreWebView2 != null) browser.Reload(); return true; }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { smokeTimeout.Dispose(); tray.Dispose(); browser.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
