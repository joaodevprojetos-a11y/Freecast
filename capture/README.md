# What we found in C:\RRPG\rrpg.exe

rrpg.exe is a program for Windows, built for x86 (32-bit). It looks like it was made with Delphi or C++Builder. Its internal names were removed (stripped), so most functions will have generated names.

Evidence ev_bda31e650e38e74525bcd10f5585fb3b98aaefeb46c58df0f63e85ccc6a5a219.

```json
{
  "architecture": "x86",
  "bits": 32,
  "dotnet_arch": null,
  "entry_point": "0x2165cf0",
  "format": "pe",
  "format_name": "PE (Windows)",
  "kind": "executable",
  "libraries": [
    "DWrite.dll",
    "DbgHelp.dll",
    "Kernel32.dll",
    "SHFolder.dll",
    "URLMON.DLL",
    "Ws2_32.dll",
    "advapi32.dll",
    "avcodec-57.dll",
    "avformat-57.dll",
    "avutil-55.dll",
    "comctl32.dll",
    "comdlg32.dll",
    "d2d1.dll",
    "d3d9.dll",
    "d3dx9_32.dll",
    "gdi32.dll",
    "gdiplus.dll",
    "kernel32.dll",
    "lua53x86.dll",
    "msvcrt.dll",
    "netapi32.dll",
    "ole32.dll",
    "oleacc.dll",
    "oleaut32.dll",
    "shell32.dll",
    "shlwapi.dll",
    "swresample-2.dll",
    "swscale-4.dll",
    "user32.dll",
    "version.dll",
    "wininet.dll",
    "winmm.dll"
  ],
  "next_steps": [
    {
      "tool": "core_overview_show",
      "why": "a one-page summary: sections, imports, counts"
    },
    {
      "tool": "native_functions_list",
      "why": "every function we found"
    },
    {
      "tool": "native_strings_find",
      "why": "find text the program shows or uses"
    },
    {
      "tool": "native_function_study",
      "why": "a full dossier on one function (start with main or the entry point)"
    },
    {
      "tool": "core_feature_find",
      "why": "follow a word you see in the app to the code behind it"
    },
    {
      "tool": "native_pe_resources_list",
      "why": "icons, version information and the manifest"
    }
  ],
  "operating_system": "Windows",
  "plain_english": "rrpg.exe is a program for Windows, built for x86 (32-bit). It looks like it was made with Delphi or C++Builder. Its internal names were removed (stripped), so most functions will have generated names.",
  "recommended_toolsets": [
    "core",
    "native",
    "formats"
  ],
  "stripped": true,
  "symbol_table_stripped": true,
  "toolchain_hints": [
    {
      "category": "language",
      "evidence": "an .itext section",
      "id": "delphi",
      "label": "Delphi or C++Builder",
      "strength": "strong"
    }
  ]
}
```

## Ghidra

Ghidra couldn't analyse C:\RRPG\rrpg.exe (could not start Ghidra: Ghidra's analysis failed; see C:\Users\João\Downloads\craft-anything-0.3.0-windows-x64-portable\craft-anything-0.3.0-windows-x64-portable\CraftAnythingData\engines\ghidra-cache\03934bceed34f93f-f2dfab6faedc84f0.log), so decompiling uses the built-in decompiler.
