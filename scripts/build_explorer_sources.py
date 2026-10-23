#!/usr/bin/env python3
"""Bundle the explorer's pinned UTF-8 source as independently loadable data.

The source index selects both the file set and the Git commit. This generator
never reads HEAD or working-tree source files. A browser can load each generated
assignment with a script element, including from a local file:// preview.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

from build_explorer_index import ROOT, read_index


SITE = ROOT / "docs/explorer"
MANIFEST = SITE / "source-manifest.js"
SOURCE_DIR = SITE / "source-files"
MANIFEST_PREFIX = "window.GENESIS_SOURCE_MANIFEST = "
SOURCE_PREFIX = "(window.GENESIS_SOURCE_FILES ||= {})["


def json_literal(value) -> str:
    """Use JSON strings, escaping HTML delimiters and JavaScript line separators."""
    return json.dumps(value, ensure_ascii=True, separators=(",", ":")).replace("<", "\\u003c")


def serialize_manifest(manifest: dict) -> str:
    return MANIFEST_PREFIX + json_literal(manifest) + ";\n"


def read_manifest(path: Path = MANIFEST) -> dict:
    """Read the manifest's JSON assignment without executing JavaScript."""
    text = path.read_text(encoding="utf-8")
    if not text.startswith(MANIFEST_PREFIX) or not text.endswith(";\n"):
        raise ValueError("Source manifest must contain one JSON assignment")
    result = json.loads(text[len(MANIFEST_PREFIX):-2])
    if not isinstance(result, dict):
        raise ValueError("Source manifest must be an object")
    return result


def serialize_source(path: str, source: str) -> str:
    """Register only a JSON string; source code is never evaluated."""
    return SOURCE_PREFIX + json_literal(path) + "] = " + json_literal(source) + ";\n"


def parse_source(text: str) -> tuple[str, str]:
    """Extract a source registration's path and text without evaluating it."""
    if not text.startswith(SOURCE_PREFIX):
        raise ValueError("Source asset must contain one data registration")
    decoder = json.JSONDecoder()
    remaining = text[len(SOURCE_PREFIX):]
    path, end = decoder.raw_decode(remaining)
    remaining = remaining[end:]
    if not remaining.startswith("] = "):
        raise ValueError("Source asset must assign its JSON path")
    source, end = decoder.raw_decode(remaining[4:])
    if remaining[4:][end:] != ";\n" or not isinstance(path, str) or not isinstance(source, str):
        raise ValueError("Source asset must assign only a JSON string")
    return path, source


def asset_for(path: str) -> str:
    """Stable, filesystem-safe names independent of source content changes."""
    return "source-files/" + hashlib.sha256(path.encode("utf-8")).hexdigest() + ".js"


def source_blob(commit: str, path: str) -> bytes:
    return subprocess.check_output(
        ["git", "cat-file", "blob", f"{commit}:{path}"], cwd=ROOT,
    )


def build_sources(index: dict | None = None) -> tuple[dict, dict[str, str]]:
    """Return (manifest, assets), with assets keyed by site-relative JS path.

    ``bytes`` and ``sha256`` describe the original UTF-8 Git blob, not its JSON
    encoding. ``lineCount`` uses the same splitlines convention as the index.
    The optional index argument is useful for validation; the default is always
    the recorded source-index.js, whose full commit SHA pins every blob read.
    """
    if index is None:
        index = read_index()
    commit = index["commit"]
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Source index must pin a full Git commit SHA")
    subprocess.check_call(
        ["git", "cat-file", "-e", commit + "^{commit}"], cwd=ROOT,
        stdout=subprocess.DEVNULL,
    )
    manifest = {"sourceCommit": commit, "files": {}}
    assets = {}
    for record in sorted(index["files"], key=lambda file: file["path"]):
        path = record["path"]
        relative = PurePosixPath(path)
        if (not path.startswith("src/spdyn/") or relative.is_absolute()
                or ".." in relative.parts or relative.as_posix() != path):
            raise ValueError(f"Source path is outside the indexed directory: {path}")
        if path in manifest["files"]:
            raise ValueError(f"Duplicate indexed source path: {path}")
        raw = source_blob(commit, path)
        source = raw.decode("utf-8")
        checksum = hashlib.sha256(raw).hexdigest()
        line_count = len(source.splitlines())
        if checksum != record["sha256"] or line_count != record["lines"]:
            raise ValueError(f"Source index metadata differs from the pinned Git blob: {path}")
        asset = asset_for(path)
        registration = serialize_source(path, source)
        decoded_path, decoded_source = parse_source(registration)
        if decoded_path != path or decoded_source.encode("utf-8") != raw:
            raise ValueError(f"Source asset failed its exact byte round trip: {path}")
        manifest["files"][path] = {
            "asset": asset,
            "lineCount": line_count,
            "bytes": len(raw),
            "sha256": checksum,
            "language": record["language"],
        }
        assets[asset] = registration
    return manifest, assets


def check_sources(index: dict | None = None) -> list[str]:
    """Return mismatches against the pinned Git blobs, without modifying files."""
    manifest, assets = build_sources(index)
    errors = []
    if not MANIFEST.exists():
        errors.append("Missing docs/explorer/source-manifest.js")
    elif MANIFEST.read_bytes() != serialize_manifest(manifest).encode("utf-8"):
        errors.append("Source manifest differs from the indexed Git snapshot")
    expected_paths = set(assets)
    actual_paths = {path.relative_to(SITE).as_posix() for path in SOURCE_DIR.glob("*.js")}
    for asset in sorted(expected_paths - actual_paths):
        errors.append(f"Missing source asset: {asset}")
    for asset in sorted(actual_paths - expected_paths):
        errors.append(f"Unexpected source asset: {asset}")
    for asset in sorted(expected_paths & actual_paths):
        if (SITE / asset).read_bytes() != assets[asset].encode("utf-8"):
            errors.append(f"Source asset differs from its exact pinned Git blob: {asset}")
    return errors


def write_sources(manifest: dict, assets: dict[str, str]) -> None:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    for asset, data in assets.items():
        (SITE / asset).write_bytes(data.encode("utf-8"))
    for path in SOURCE_DIR.glob("*.js"):
        if path.relative_to(SITE).as_posix() not in assets:
            path.unlink()
    # Publish the manifest after the assets it names are available.
    MANIFEST.write_bytes(serialize_manifest(manifest).encode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify generated assets against the indexed Git commit")
    args = parser.parse_args()
    if args.check:
        errors = check_sources()
        if errors:
            raise SystemExit("Explorer source assets failed validation:\n- " + "\n- ".join(errors))
        manifest = read_manifest()
        print(f"Explorer source assets verified: {len(manifest['files'])} exact UTF-8 files; "
              f"snapshot {manifest['sourceCommit'][:7]}.")
    else:
        manifest, assets = build_sources()
        write_sources(manifest, assets)
        total = sum(file["bytes"] for file in manifest["files"].values())
        bundled = sum(len(asset.encode("utf-8")) for asset in assets.values())
        print(f"Wrote {len(assets)} lazy source assets: {total:,} source bytes, "
              f"{bundled:,} bundled bytes; snapshot {manifest['sourceCommit'][:7]}.")


if __name__ == "__main__":
    main()
