using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace DevicePreviewLab
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string log = Path.Combine(root, ".logs", "native-launcher.log");
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(log));
                string script = Path.Combine(root, "Start-DevicePreviewLab.ps1");
                if (!File.Exists(script)) throw new FileNotFoundException("The PowerShell launcher is missing.", script);
                string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                    @"WindowsPowerShell\v1.0\powershell.exe");
                var command = new StringBuilder(QuoteArgument(powershell));
                command.Append(" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ");
                command.Append(QuoteArgument(script));
                foreach (string arg in args) command.Append(" ").Append(QuoteArgument(arg));

                using (var job = Native.CreateJobObject(IntPtr.Zero, null))
                {
                    if (job.IsInvalid) throw new Win32Exception();
                    var limits = new Native.ExtendedLimits();
                    limits.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                    if (!Native.SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)))
                        throw new Win32Exception();

                    var startup = new Native.StartupInfo();
                    startup.Size = (uint)Marshal.SizeOf(startup);
                    startup.Flags = 1; // STARTF_USESHOWWINDOW
                    Native.ProcessInfo process;
                    // Suspend until ownership is established: no child can escape the job during startup.
                    if (!Native.CreateProcess(powershell, command, IntPtr.Zero, IntPtr.Zero, false,
                        0x08000004, IntPtr.Zero, root, ref startup, out process))
                        throw new Win32Exception();
                    try
                    {
                        if (!Native.AssignProcessToJobObject(job, process.Process)) throw new Win32Exception();
                        if (Native.ResumeThread(process.Thread) == uint.MaxValue) throw new Win32Exception();
                        WriteLog(log, "Console-free supervisor started. LauncherPid=" + Process.GetCurrentProcess().Id +
                            "; SupervisorPid=" + process.ProcessId);
                        if (Native.WaitForSingleObject(process.Process, uint.MaxValue) != 0) throw new Win32Exception();
                        uint exitCode;
                        if (!Native.GetExitCodeProcess(process.Process, out exitCode)) throw new Win32Exception();
                        WriteLog(log, "Supervisor exited. ExitCode=" + exitCode + ". Releasing owned processes.");
                        if (exitCode != 0)
                            throw new InvalidOperationException("Device Preview Lab could not start or stopped unexpectedly. See the .logs folder for details.");
                        return 0;
                    }
                    catch
                    {
                        Native.TerminateProcess(process.Process, 1);
                        throw;
                    }
                    finally
                    {
                        Native.CloseHandle(process.Thread);
                        Native.CloseHandle(process.Process);
                    }
                    // Closing the job also stops any remaining owned Node/browser descendants.
                }
            }
            catch (Exception error)
            {
                WriteLog(log, "Launcher error: " + error.Message);
                Native.MessageBox(IntPtr.Zero, error.Message, "Device Preview Lab", 0x10);
                return 1;
            }
        }

        internal static string QuoteArgument(string value)
        {
            var result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char ch in value)
            {
                if (ch == '\\') { slashes++; continue; }
                result.Append('\\', ch == '"' ? slashes * 2 + 1 : slashes);
                result.Append(ch);
                slashes = 0;
            }
            result.Append('\\', slashes * 2).Append('"');
            return result.ToString();
        }

        private static void WriteLog(string log, string message)
        {
            try { File.AppendAllText(log, DateTimeOffset.Now.ToString("o") + " " + message + Environment.NewLine); }
            catch { /* Logging must not prevent process cleanup. */ }
        }
    }

    internal static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        internal struct BasicLimits
        {
            public long ProcessTime, JobTime;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)]
        internal struct IoCounters
        {
            public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
        }
        [StructLayout(LayoutKind.Sequential)]
        internal struct ExtendedLimits
        {
            public BasicLimits Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemory, PeakJobMemory;
        }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct StartupInfo
        {
            public uint Size;
            public string Reserved, Desktop, Title;
            public uint X, Y, XSize, YSize, XChars, YChars, FillAttribute, Flags;
            public ushort ShowWindow, ReservedSize;
            public IntPtr ReservedData, StdInput, StdOutput, StdError;
        }
        [StructLayout(LayoutKind.Sequential)]
        internal struct ProcessInfo
        {
            public IntPtr Process, Thread;
            public uint ProcessId, ThreadId;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern SafeFileHandle CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool SetInformationJobObject(SafeFileHandle job, int infoClass, ref ExtendedLimits limits, uint size);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes,
            IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory,
            ref StartupInfo startup, out ProcessInfo process);
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool TerminateProcess(IntPtr process, uint exitCode);
        [DllImport("kernel32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        internal static extern int MessageBox(IntPtr owner, string text, string caption, uint type);
    }
}
