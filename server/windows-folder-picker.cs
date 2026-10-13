using System;
using System.Runtime.InteropServices;

namespace OpenZero {
    // Windows Common Item Dialog in folder mode, not the legacy folder tree.
    // https://learn.microsoft.com/windows/win32/shell/common-file-dialog
    public static class NativeFolderPicker {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        private static extern int SHCreateItemFromParsingName(string path, IntPtr context, ref Guid id, [MarshalAs(UnmanagedType.Interface)] out IShellItem item);

        public static string Choose(string initialDirectory) {
            IFileDialog dialog = (IFileDialog)new FileOpenDialog();
            IShellItem initial = null, selected = null;
            IntPtr displayName = IntPtr.Zero;
            try {
                uint options;
                dialog.GetOptions(out options);
                dialog.SetOptions(options | 0x20 | 0x40 | 0x800 | 0x1000);
                dialog.SetTitle("Open Zero - Open project folder");
                dialog.SetOkButtonLabel("Open project");
                if (!String.IsNullOrEmpty(initialDirectory)) {
                    Guid itemId = typeof(IShellItem).GUID;
                    int result = SHCreateItemFromParsingName(initialDirectory, IntPtr.Zero, ref itemId, out initial);
                    Marshal.ThrowExceptionForHR(result);
                    dialog.SetFolder(initial);
                }
                int status = dialog.Show(IntPtr.Zero);
                if (status == unchecked((int)0x800704C7)) return null;
                Marshal.ThrowExceptionForHR(status);
                dialog.GetResult(out selected);
                selected.GetDisplayName(0x80058000, out displayName); // SIGDN_FILESYSPATH
                return Marshal.PtrToStringUni(displayName);
            } finally {
                if (displayName != IntPtr.Zero) Marshal.FreeCoTaskMem(displayName);
                if (selected != null) Marshal.FinalReleaseComObject(selected);
                if (initial != null) Marshal.FinalReleaseComObject(initial);
                Marshal.FinalReleaseComObject(dialog);
            }
        }

        [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
        private class FileOpenDialog { }

        [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IFileDialog {
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
            void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
            void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
            void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
            void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
            void GetResult(out IShellItem result);
            void AddPlace(IShellItem place, uint alignment);
            void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
            void Close(int status);
            void SetClientGuid(ref Guid id);
            void ClearClientData();
            void SetFilter(IntPtr filter);
        }

        [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellItem {
            void BindToHandler(IntPtr context, ref Guid handler, ref Guid id, out IntPtr result);
            void GetParent(out IShellItem parent);
            void GetDisplayName(uint kind, out IntPtr name);
            void GetAttributes(uint mask, out uint attributes);
            void Compare(IShellItem other, uint hint, out int order);
        }
    }
}
