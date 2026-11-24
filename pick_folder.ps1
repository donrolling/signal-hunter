# Windows' modern folder picker (the Explorer-style one with an address bar you can paste into).
# Windows PowerShell 5.1 only offers the old "Browse For Folder" tree, so this calls the shell's
# IFileOpenDialog directly. Prints the chosen folder, or nothing if cancelled.
# Usage: powershell -NoProfile -STA -ExecutionPolicy Bypass -File pick_folder.ps1 [-Start <folder>] [-Title <text>]
param([string]$Start = '', [string]$Title = 'Export clips to')

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class ModernFolderPicker {
    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialog {}

    // IFileOpenDialog vtable, in order. Only the methods we call need real signatures.
    [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileOpenDialog {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(); void SetFileTypeIndex(); void GetFileTypeIndex(); void Advise(); void Unadvise();
        void SetOptions(uint fos); void GetOptions(out uint fos);
        void SetDefaultFolder(IShellItem si); void SetFolder(IShellItem si); void GetFolder(); void GetCurrentSelection();
        void SetFileName(); void GetFileName();
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel(); void GetResult(out IShellItem si);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem {
        void BindToHandler(); void GetParent();
        void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr bc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem si);

    public static string Pick(IntPtr owner, string start, string title) {
        var d = (IFileOpenDialog)new FileOpenDialog();
        d.SetOptions(0x20 | 0x40 | 0x800);  // pick folders, file-system only, path must exist
        d.SetTitle(title);
        d.SetOkButtonLabel("Use this folder");
        if (!string.IsNullOrEmpty(start)) {
            try { IShellItem si; SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out si); d.SetFolder(si); } catch {}
        }
        if (d.Show(owner) != 0) return "";  // cancelled
        IShellItem result; string path;
        d.GetResult(out result);
        result.GetDisplayName(0x80058000, out path);  // SIGDN_FILESYSPATH
        return path;
    }
}
'@

Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }  # keeps the dialog in front of Live
[ModernFolderPicker]::Pick($owner.Handle, $Start, $Title)
