# Bazecor MCP

> **Personal, unofficial fork of [Dygma's Bazecor](https://github.com/Dygmalab/Bazecor).**
> This project aims to make Bazecor's configuration functions available through the
> Model Context Protocol (MCP), so an agent can connect to the running desktop app
> and control the same configuration you see and edit in the UI.
> **MCP control is not implemented yet in this checkout.** The existing keyboard
> configurator works independently of that planned integration.

Linux x86-64 AppImage is the primary distribution target. This fork is maintained
for personal use by Chris Pilcher and is not an official Dygma release. Upstream
copyright notices and the GPL-3.0-only license remain in effect.

## Download and run on Linux

Download the `.AppImage` and `SHA256SUMS` from this fork's
[Releases](https://github.com/chris-pilcher/bazecor-mcp/releases). A release appears
there after a successful tagged build. Then, in the download directory:

```sh
sha256sum --check SHA256SUMS
chmod +x Bazecor-MCP-*.AppImage
./Bazecor-MCP-*.AppImage
```

An AppImage is a portable application: no package installation is required. Keep
one downloaded version in its own directory when using the wildcard commands
above. Normal Dygma USB/serial access permissions still apply. If your system
reports that `libfuse.so.2` is missing, install your distribution's FUSE 2
compatibility package, or extract and run the image:

```sh
./Bazecor-MCP-*.AppImage --appimage-extract
./squashfs-root/AppRun
```

The fork uses its own application name and settings directory. Automatic updates
from the official Bazecor repository are disabled; download new fork versions
from the Releases page.

## Personal builds and releases

The **Linux AppImage** GitHub Actions workflow runs tests and builds the AppImage
on pushes, pull requests, and manual runs. Download the `Bazecor-MCP-linux-x64`
artifact from a successful run for a build without publishing a release. These
builds do not need Dygma's signing credentials or custom repository secrets.

To publish a personal release, push a tag beginning with `mcp-v`, for example:

```sh
git tag mcp-v0.1.0
git push origin mcp-v0.1.0
```

The tag workflow tests and builds the tagged source, then publishes the AppImage
and SHA-256 checksum in a GitHub Release using the built-in `GITHUB_TOKEN`.
Release assets include the tag in their name; untagged builds include the commit
SHA. Tags containing a hyphen after the version (for example,
`mcp-v0.1.0-beta.1`) are published as prereleases. The embedded application version
currently follows upstream's `package.json` version. Publishing is restricted to
this fork. Linux is the required build; macOS and Windows remain available as
local build targets below.

For a local Linux build, use Node.js 22.14 or newer and Yarn 1.22.22, install
`build-essential`, `python3`, `pkg-config`, `libudev-dev`, and `libusb-1.0-0-dev`,
then run:

```sh
yarn install --frozen-lockfile
yarn make-lin
```

The AppImage is written beneath `out/make/`. Flatpak is optional and is not part
of the personal release workflow.

---

The following documentation describes the upstream application.

![Bazecor screenshot](data/screenshot.png)

## About

Bazecor is the graphical configurator for the Dygma Raise & Defy. While still heavily under development, it's at a stage where it is already usable.

The primary purpose of the application is to allow one to configure their keyboard without having to compile or flash firmware, by storing the configuration on the keyboard itself, in EEPROM. There are no external tools required, just Bazecor itself.

## Features

* **Layout editor** to edit the keymap on-the-fly, with the ability to copy one
  layer to another, and to set a default one.
* **Macro editor** to create and manage macros for the keyboard, it also allows you to backup a single macro or all of them, so you can share them with more Raise users or just back them up.
* **Colormap editor** to edit the per-key and underglow LED colormap.
* **Firmware upgrade** to upload new versions of the firmware that ships with the application.

## Supported operating systems

Bazecor is supported on all three major operating systems, we test our releases on Windows 10, MacOS, and Ubuntu LTS.

The protocol Bazecor uses to communicate with the keyboard requires USB serial
support, which is known to be problematic on Windows prior to Windows 10.

## Reporting issues

Bazecor is beta quality software. There will be bugs, missing features and
non-obvious things. Reporting any and all of these help us make the software
better, please feel free to [open issues][issues] liberally!

 [issues]: https://github.com/chris-pilcher/bazecor-mcp/issues

## Development

To launch the development environment, simply install nodejs and yarn (check node version in package.json engine.node) then type `yarn && yarn start`.

To do a local production build without signing the executable use `yarn run make-dev`.

To do a production build, use `yarn run make`, or limit it to a particular OS:

| OS      | Architecture | Command                   |
|---------|--------------|---------------------------|
| Windows |              | `yarn run make-win`       |
| macOS   |              | `yarn run make-mac`       |
| macOS   | x64          | `yarn run make-mac-intel` |
| macOS   | arm64        | `yarn run make-mac-arm`   |
| Linux   |              | `yarn run make-lin`       |
| Linux   | Flatpak      | `yarn run make-flatpak`   |

See the `scripts` section of `package.json` for more scripts.

`make-lin` builds the AppImage. The Flatpak is only built by `make-flatpak` (or with `BAZECOR_FLATPAK=true`), since it needs `flatpak-builder` and `eu-strip` (from `elfutils`) installed, and the Flathub remote configured as shown below.

### Development on Windows

If you are using Windows, you will need `node-gyp` and `python3`:

```sh
# install python3 using winget
# note that python 3.12 doesn't work
winget install python.python.3.10.0

# install node-gyp
npm install -g node-gyp
```

If you are using WSL (with ubuntu), you will also need `libudev-dev`. To build the Flatpak, you will also need `flatpak-builder` and to configure flatpak if you haven't done so:

```sh
# Install system dependencies 
sudo apt update
sudo apt install flatpak-builder libudev-dev

# Add User-level Flathub remote
flatpak remote-add --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo
```

## Additional Information

To get more information about our efforts, how Bazecor communicates with the Raise and the latest development news, please check the links below

* [News](https://github.com/Dygmalab/Bazecor/blob/development/NEWS.md)
* [Code of conduct](https://github.com/Dygmalab/Bazecor/blob/development/CODE_OF_CONDUCT.md)
* [How does Bazecor program the Raise Keyboard?](https://github.com/Dygmalab/Bazecor/blob/development/FOCUS_API.md)
