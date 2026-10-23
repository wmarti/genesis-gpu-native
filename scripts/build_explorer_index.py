#!/usr/bin/env python3
"""Build the static explorer's lexical source index, using only the standard library.

Run from any directory: python3 scripts/build_explorer_index.py
This is a source inventory, not a compiler, call graph, or coverage measurement.
Conditional compilation branches are included without evaluating their conditions.
"""

from __future__ import annotations

import argparse
import bisect
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs/explorer/source-index.js"
PREFIX = "window.GENESIS_SOURCE_INDEX = "
LANGUAGES = {
    ".fpp": "Fortran", ".f90": "Fortran", ".f95": "Fortran", ".f": "Fortran",
    ".c": "C", ".cpp": "C++", ".cc": "C++", ".cxx": "C++",
    ".cu": "CUDA", ".cuh": "CUDA", ".h": "C/C++ header", ".hpp": "C++ header",
}
FORTRAN_ROUTINE = re.compile(
    r"^\s*(?:(?:pure|impure|elemental|recursive|module)\s+)*"
    r"(?:(?:integer|real|logical|complex|character|double\s+precision|type|class)"
    r"\s*(?:\([^)]*\)|\*\d+)?\s+)?"
    r"(?P<kind>subroutine|function)\s+(?P<name>[a-z_]\w*)\s*\(", re.I
)
CPP_CANDIDATE = re.compile(
    r"^[ \t]*(?P<prefix>[^\n;{}=]*?)(?P<name>[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)"
    r"\s*\(", re.M
)
CPP_NON_FUNCTIONS = {
    "if", "for", "while", "switch", "catch", "sizeof", "alignof", "decltype",
    "static_assert", "return", "new", "delete", "__launch_bounds__",
}


def blank_match(match: re.Match[str]) -> str:
    """Remove text without moving any character offsets or line numbers."""
    return re.sub(r"[^\n]", " ", match.group(0))


def cpp_without_comments(text: str) -> str:
    # Treat quoted text as one token so a comment marker inside a string is inert.
    text = re.sub(
        r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'',
        blank_match, text,
    )
    return re.sub(r"^[ \t]*\#(?:[^\n]*\\\n)*[^\n]*", blank_match, text, flags=re.M)


def fortran_symbols(text: str):
    interface_depth = 0
    for line_number, original in enumerate(text.splitlines(), 1):
        # Quoted exclamation marks do not start comments.
        line = re.sub(r"'(?:(?:'')|[^'])*'|\"(?:(?:\"\")|[^\"])*\"", "''", original)
        line = line.split("!", 1)[0]
        if re.match(r"^\s*end\s*interface\b", line, re.I):
            interface_depth = max(0, interface_depth - 1)
            continue
        if re.match(r"^\s*(?:abstract\s+)?interface\b", line, re.I):
            interface_depth += 1
            continue
        match = FORTRAN_ROUTINE.match(line)
        if match:
            kind = match["kind"].lower()
            if interface_depth:
                kind = "interface " + kind
            yield {"name": match["name"], "line": line_number, "kind": kind}


def cpp_symbols(text: str, language: str):
    clean = cpp_without_comments(text)
    newlines = [position for position, char in enumerate(clean) if char == "\n"]
    for match in CPP_CANDIDATE.finditer(clean):
        name, prefix = match["name"], match["prefix"].strip()
        if name in CPP_NON_FUNCTIONS or not re.fullmatch(r"[\w\s:<>,*&~]*", prefix):
            continue
        if re.search(r"\b(?:return|else|case|throw|typedef|using)\b", prefix):
            continue
        # Find the end of the argument list, including nested function types.
        cursor, depth = match.end(), 1
        while cursor < len(clean) and depth:
            depth += (clean[cursor] == "(") - (clean[cursor] == ")")
            cursor += 1
        if depth:
            continue
        ending = re.search(r"[;{}]", clean[cursor:])
        if ending is None or ending[0] != "{":
            continue
        suffix = clean[cursor:cursor + ending.start()].strip()
        # Ordinary definitions and const/noexcept methods; reject expressions
        # between a function call and a later unrelated block.
        if suffix and not re.fullmatch(
            r"(?:(?:const|volatile|noexcept|override|final)\b\s*|&{1,2}\s*)+", suffix
        ):
            continue
        kind = "CUDA kernel" if "__global__" in prefix else "function"
        if "__device__" in prefix and kind != "CUDA kernel":
            kind = "device function"
        yield {
            "name": name,
            "line": bisect.bisect_left(newlines, match.start("name")) + 1,
            "kind": kind,
        }


def build_index(commit: str | None = None) -> dict:
    if commit is None:
        commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip()
    files, symbols = [], []
    for path in sorted((ROOT / "src/spdyn").rglob("*")):
        language = LANGUAGES.get(path.suffix.lower())
        if not path.is_file() or language is None:
            continue
        raw = path.read_bytes()
        text = raw.decode("utf-8", errors="replace")
        relative = path.relative_to(ROOT).as_posix()
        found = list(fortran_symbols(text) if language == "Fortran" else cpp_symbols(text, language))
        files.append({
            "path": relative, "name": path.name, "language": language,
            "lines": len(text.splitlines()), "symbols": len(found),
            "sha256": hashlib.sha256(raw).hexdigest(),
        })
        symbols.extend({**symbol, "path": relative} for symbol in found)
    return {
        "schemaVersion": 1,
        "repository": "https://github.com/wmarti/genesis-gpu-native",
        "commit": commit,
        "scope": "src/spdyn",
        "methodology": (
            "Lexical source inventory: Fortran routines and interface declarations, "
            "C/C++ function definitions, and CUDA kernels/device functions. "
            "Includes conditional compilation branches. Not a semantic call graph; "
            "macros, complex declarators, and generated code may not be indexed. "
            "Line counts include comments and blank lines."
        ),
        "stats": {
            "files": len(files), "lines": sum(file["lines"] for file in files),
            "symbols": len(symbols),
            "definitions": sum(not symbol["kind"].startswith("interface ") for symbol in symbols),
            "interfaces": sum(symbol["kind"].startswith("interface ") for symbol in symbols),
            "byLanguage": dict(sorted(Counter(file["language"] for file in files).items())),
            "byKind": dict(sorted(Counter(symbol["kind"] for symbol in symbols).items())),
        },
        "files": files,
        "symbols": symbols,
    }


def serialize(index: dict) -> str:
    return (
        "// Generated by scripts/build_explorer_index.py. Do not edit by hand.\n"
        + PREFIX + json.dumps(index, ensure_ascii=True, separators=(",", ":")) + ";\n"
    )


def read_index(path: Path = OUTPUT) -> dict:
    text = path.read_text(encoding="utf-8")
    return json.loads(text.split(PREFIX, 1)[1].rstrip().removesuffix(";"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check the recorded snapshot without rewriting it")
    args = parser.parse_args()
    if args.check:
        recorded = read_index()
        if serialize(build_index(recorded["commit"])) != OUTPUT.read_text(encoding="utf-8"):
            raise SystemExit("Source index is stale. Run python3 scripts/build_explorer_index.py")
        print("Source index matches the source inventory.")
    else:
        index = build_index()
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(serialize(index), encoding="utf-8")
        print(f"Wrote {OUTPUT.relative_to(ROOT)}: {index['stats']['files']} files, "
              f"{index['stats']['symbols']} lexical symbols, {OUTPUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
