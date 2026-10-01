using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;

internal static class FolderPicker
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 1) return 2;
        IFileDialog dialog = (IFileDialog)new FileOpenDialog();
        try
        {
            // Native Explorer folder picker: folders only, real filesystem paths, no recent-item entry.
            dialog.SetOptions(0x8 | 0x20 | 0x40 | 0x800 | 0x2000000);
            dialog.SetTitle("Terminal Hall — choose your project folder");
            dialog.SetOkButtonLabel("Open terminal here");
            int result = dialog.Show(IntPtr.Zero);
            if (result == unchecked((int)0x800704C7)) return 1;
            Marshal.ThrowExceptionForHR(result);
            IShellItem folder;
            dialog.GetResult(out folder);
            try
            {
                IntPtr name;
                folder.GetDisplayName(0x80058000, out name);
                try { File.WriteAllText(args[0], Marshal.PtrToStringUni(name), new UTF8Encoding(false)); }
                finally { Marshal.FreeCoTaskMem(name); }
            }
            finally { Marshal.ReleaseComObject(folder); }
            return 0;
        }
        catch { return 2; }
        finally { Marshal.ReleaseComObject(dialog); }
    }

    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    private class FileOpenDialog { }

    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr types);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem selection);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem result);
        void AddPlace(IShellItem place, uint alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid interfaceId, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint kind, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem other, uint hint, out int order);
    }
}
