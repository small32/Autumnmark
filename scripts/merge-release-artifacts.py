import argparse
import base64
import hashlib
import shutil
from pathlib import Path

import yaml


def merge_artifacts(source: Path, destination: Path, version: str) -> None:
    targets = [
        ('macos-arm64', 'autumnmark-mac.yml', f'autumnmark-mac-arm64-{version}',
         ('.dmg', '.dmg.blockmap', '.zip', '.zip.blockmap')),
        ('windows-x64', 'autumnmark.yml', f'autumnmark-win-x64-{version}',
         ('-setup.exe', '-setup.exe.blockmap', '.zip')),
    ]
    assets = {}
    for target, manifest_name, basename, suffixes in targets:
        directory = source / f'autumnmark-{target}'
        manifest_path = directory / manifest_name
        document = yaml.safe_load(manifest_path.read_text(encoding='utf-8'))
        if document['version'] != version:
            raise ValueError(f'{manifest_name}: version does not match release {version}')

        names = {basename + suffix for suffix in suffixes}
        for name in names:
            path = directory / name
            if not path.is_file():
                raise ValueError(f'{target}: missing release asset {name}')
            assets[name] = path

        checksums = {}
        for file in document['files']:
            name = file['url']
            if name not in names or name in checksums:
                raise ValueError(f'{manifest_name}: unexpected or duplicate asset {name}')
            path = directory / name
            if path.stat().st_size != file['size']:
                raise ValueError(f'{manifest_name}: incorrect size for {name}')
            with path.open('rb') as stream:
                digest = base64.b64encode(hashlib.file_digest(stream, 'sha512').digest()).decode()
            if digest != file['sha512']:
                raise ValueError(f'{manifest_name}: incorrect checksum for {name}')
            checksums[name] = digest

        # Older updater clients read the top-level path and checksum.
        legacy_path = document.get('path')
        if legacy_path not in checksums or checksums[legacy_path] != document.get('sha512'):
            raise ValueError(f'{manifest_name}: legacy path/checksum does not match a verified file')
        assets[manifest_name] = manifest_path

        diagnostics = directory / 'builder-debug.yml'
        if diagnostics.is_file():
            assets.setdefault(diagnostics.name, diagnostics)

    destination.mkdir(parents=True, exist_ok=True)
    for name, path in assets.items():
        shutil.copy2(path, destination / name)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('version')
    args = parser.parse_args()
    merge_artifacts(args.source, args.destination, args.version)
