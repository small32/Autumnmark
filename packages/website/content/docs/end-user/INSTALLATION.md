# Installation

MarkText is a free, open-source Markdown editor for **macOS** and **Windows**. Pre-built binaries are published with every release on [GitHub releases](https://github.com/marktext/marktext/releases/latest). Pick the one that matches your platform.

## Windows

| Artifact                               | When to choose                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `marktext-win-x64-<version>-setup.exe` | Recommended. NSIS installer; per-user install, lets you pick the install directory, creates Start Menu and Desktop shortcuts.               |
| `marktext-win-x64-<version>.zip`       | Portable zip. Extract anywhere and run `marktext.exe`. See [Portable mode](PORTABLE.md) for details on keeping your data alongside the app. |

For Windows on ARM, choose the corresponding `marktext-win-arm64-<version>-setup.exe` or `.zip` artifact.

After installing, MarkText registers itself as a handler for `.md`, `.markdown`, `.mmd`, `.mdown`, `.mdtxt` and `.mdtext` files.

## macOS

The current application requires macOS 13 (Ventura) or later; see [supported platforms](FAQ.md#what-are-the-supported-platforms).

| Artifact                            | When to choose                    |
| ----------------------------------- | --------------------------------- |
| `marktext-mac-arm64-<version>.dmg`  | Apple Silicon.                    |
| `marktext-mac-x64-<version>.dmg`    | Intel Macs.                       |
| `marktext-mac-<arch>-<version>.zip` | Plain zip alternative to the DMG. |

Open the DMG and drag MarkText into your **Applications** folder. The packaging configuration sets `mac.notarize: false`, so macOS may block the first launch. If macOS blocks the app, review the system's security prompt before proceeding.

## Verify the download

All artifacts are listed with their SHA-256 in `SHA256SUMS.txt`. Verify with:

```sh
# With GNU coreutils
sha256sum -c SHA256SUMS.txt --ignore-missing
```

On macOS, use `shasum -a 256 <downloaded-file>` and compare its output with the matching entry in `SHA256SUMS.txt`.

## Build from source

If you'd rather build from source — for example to track `develop`, to run on an architecture we don't publish a binary for, or to contribute — see the [Build instructions](../dev/BUILD.md) in the developer docs. A minimal recap:

```sh
git clone https://github.com/marktext/marktext.git
cd marktext
pnpm install
pnpm run build:win:x64
```

This example packages Windows x64. For Apple Silicon, use the `build:mac:arm64` script. Installers land in the repository's `dist/` folder; `pnpm run build` alone only compiles the application.

## Updating

Use the application's **Check for Updates** action to look for an update. If one is available, MarkText asks whether to download and install it. Downloading starts after confirmation; once it finishes, the application quits to install the update. Save your work before accepting.

You can also download a newer package from the releases page and install or extract it using the instructions above.

## Uninstall

| Platform                  | How                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Windows                   | **Settings → Apps**, or run the bundled `Uninstall MarkText.exe`.                                    |
| macOS                     | Drag **MarkText.app** to the Trash. Optionally also remove `~/Library/Application Support/marktext`. |

To wipe MarkText's user data as well, remove its [application data directory](APPLICATION_DATA_DIRECTORY.md).
