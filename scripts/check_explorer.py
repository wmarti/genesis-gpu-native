#!/usr/bin/env python3
"""Verify explorer source links, the generated snapshot, and local HTML assets."""

from __future__ import annotations

import argparse
from functools import lru_cache
from html.parser import HTMLParser
import json
import re
import statistics
import subprocess
from urllib.parse import unquote, urlsplit

from build_explorer_index import ROOT, OUTPUT, build_index, read_index


REPOSITORY = "https://github.com/wmarti/genesis-gpu-native"


def load_data(filename):
    """Read a literal data asset without executing JavaScript."""
    text = (ROOT / "docs/explorer" / filename).read_text(encoding="utf-8")
    match = re.fullmatch(r"\s*window\.\w+\s*=\s*(\{.*\})\s*;\s*", text, re.S)
    if not match:
        raise ValueError(f"{filename} must contain only one JSON object assignment")
    return json.loads(match[1])


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True)


@lru_cache(maxsize=None)
def tree_paths(sha):
    return set(git("ls-tree", "-r", "--name-only", sha).splitlines())


@lru_cache(maxsize=None)
def blob_lines(sha, path):
    return git("show", f"{sha}:{path}").splitlines()


def objects(value, location="data"):
    if isinstance(value, dict):
        yield location, value
        for key, child in value.items():
            yield from objects(child, f"{location}.{key}")
    elif isinstance(value, list):
        for position, child in enumerate(value):
            yield from objects(child, f"{location}[{position}]")


def verify_references(data, expected_sha, errors):
    count = 0
    for label, item in objects(data):
        # Every source excerpt has a pinned, reproducible GitHub URL.
        if "path" in item and "line" in item:
            path, start = item["path"], item["line"]
            end = item.get("endLine", start)
            url = item.get("url", "")
            prefix = f"{REPOSITORY}/blob/{expected_sha}/{path}#L{start}"
            if url not in {prefix, prefix + f"-L{end}"}:
                errors.append(f"{label}: source URL disagrees with snapshot/path/line")
            if path not in tree_paths(expected_sha):
                errors.append(f"{label}: source path missing at snapshot: {path}")
                continue
            lines = blob_lines(expected_sha, path)
            if not isinstance(start, int) or not isinstance(end, int) or not 1 <= start <= end <= len(lines):
                errors.append(f"{label}: invalid source line range")
                continue
            if "snippet" in item and item["snippet"] != "\n".join(lines[start - 1:end]):
                errors.append(f"{label}: snippet differs from its exact pinned source lines")
            if "name" in item and not re.search(r"\b" + re.escape(item["name"]) + r"\b", "\n".join(lines[start - 1:end])):
                errors.append(f"{label}: named definition absent from source excerpt")
            count += 1
        for value in item.values():
            if not isinstance(value, str) or not value.startswith(REPOSITORY + "/blob/"):
                continue
            match = re.fullmatch(re.escape(REPOSITORY) + r"/blob/([0-9a-f]{40})/([^#]+)(?:#.*)?", value)
            if not match:
                errors.append(f"{label}: blob link must pin a full commit SHA: {value}")
                continue
            sha, path = match.groups()
            try:
                if unquote(path) not in tree_paths(sha):
                    errors.append(f"{label}: blob link path is absent at commit: {value}")
            except subprocess.CalledProcessError:
                errors.append(f"{label}: unknown blob link commit: {sha}")
    return count


def verify_architecture(data, sha, errors):
    if data["sha"] != sha:
        errors.append("Architecture and lexical index refer to different snapshots")
    components = data["components"]
    ids = [component["id"] for component in components]
    if len(ids) != len(set(ids)):
        errors.append("Architecture contains duplicate component IDs")
    definitions, selected_paths = [], set()
    for component in components:
        definitions.extend(component["functions"])
        selected_paths.update(component["paths"])
        for path in component["paths"]:
            if path not in tree_paths(sha):
                errors.append(f"Architecture component path missing at snapshot: {path}")
    for edge in data["edges"]:
        if edge["source"] not in ids or edge["target"] not in ids:
            errors.append(f"Architecture edge references an unknown component: {edge}")
        if not edge.get("evidence") or any("snippet" not in item for item in edge["evidence"]):
            errors.append(f"Architecture edge lacks inspectable source evidence: {edge['label']}")
    expected = {"components": len(components), "selectedDefinitions": len(definitions),
                "curatedRelationships": len(data["edges"]), "selectedFiles": len(selected_paths)}
    if data["stats"] != expected:
        errors.append("Architecture statistics disagree with its actual entries")
    return verify_references(data, sha, errors)


def hardware_id(label):
    for token, key in [("RTX PRO 6000", "blackwell"), ("RTX 4090", "rtx4090"),
                       ("RTX 3090", "rtx3090"), ("A100", "a100")]:
        if token in label:
            return key
    return None


def benchmark_rows(lines):
    """Independently read the documented table cells, preserving their context."""
    result, section, tuned = {}, "", False
    for line_number, line in enumerate(lines, 1):
        if line.startswith("#### "):
            section, tuned = line[5:], False
        elif line.startswith("STMV on the tuned deck"):
            tuned = True
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if section.startswith(("Mixed (", "FP64 (")):
            hardware = hardware_id(cells[0])
            if not hardware:
                continue
            precision = "FP64" if section.startswith("FP64") else "Mixed"
            contexts = [("STMV", "tuned" if tuned else "g92")] if tuned else [("STMV", "g92"), ("Cellulose", "cellulose")]
        elif section.startswith("B200, final tip") and cells[0].startswith(("STMV,", "Cellulose")):
            hardware, precision = "b200", "Mixed"
            contexts = [("Cellulose", "cellulose")] if cells[0] == "Cellulose" else [("STMV", "tuned" if "tuned" in cells[0] else "g92")]
        else:
            continue
        for position, cell in enumerate(cells[1:]):
            numeric = re.fullmatch(r"([\d.]+)\s*\(([\d.]+)\)", cell)
            if numeric is None:
                raise ValueError(f"Unrecognized benchmark table cell at README:{line_number}: {cell}")
            system, deck = contexts[position // 3]
            key = (system, deck, precision, hardware, (1, 2, 4)[position % 3])
            result[key] = (float(numeric[1]), float(numeric[2]), line_number)
    return result


def verify_measurements(data, sha, errors):
    if data["repository"]["sourceCommit"] != sha:
        errors.append("Measurements and lexical index refer to different snapshots")
    count = verify_references(data, sha, errors)
    lines = blob_lines(sha, "README.md")
    expected = benchmark_rows(lines)
    actual = {}
    for row in data["benchmarks"]:
        key = tuple(row[key] for key in ("system", "deck", "precision", "hardware", "gpus"))
        if key in actual:
            errors.append(f"Duplicate benchmark observation: {key}")
        actual[key] = (row["msPerStep"], row["nsPerDay"], row["source"]["line"])
        if row["msPerStep"] <= 0 or row["nsPerDay"] <= 0 or row["source"]["path"] != "README.md":
            errors.append(f"Invalid benchmark observation: {key}")
    if actual != expected:
        mismatches = set(actual) ^ set(expected)
        mismatches |= {key for key in set(actual) & set(expected) if actual[key] != expected[key]}
        errors.append(f"Benchmark values/context differ from README tables: {sorted(mismatches)}")

    for row in data["stockComparison"]["rows"]:
        cells = [cell.strip() for cell in lines[row["source"]["line"] - 1].strip("|").split("|")]
        if cells[0] != f"{row['system']}, {row['precision']}":
            errors.append("Stock comparison system/precision does not match source row")
        cell = cells[1 + (1, 2, 4).index(row["gpus"])]
        numbers = re.fullmatch(r"([\d.]+) / ([\d.]+) = ([\d.]+)x", cell)
        wanted = tuple(float(value) for value in numbers.groups()) if numbers else None
        actual = tuple(row[key] for key in ("nativeMsPerStep", "stockMsPerStep", "speedup"))
        if actual != wanted:
            errors.append(f"Stock comparison differs from README cell: {cell}")
        if abs(row["stockMsPerStep"] / row["nativeMsPerStep"] - row["speedup"]) > .051:
            errors.append(f"Stock comparison has an inconsistent rounded speedup: {cell}")

    for row in data["publishedGromacs"]["rows"]:
        cells = [cell.strip() for cell in lines[row["source"]["line"] - 1].strip("|").split("|")]
        if cells[0] != row["system"] or cells[1] != row["hardwareLabel"]:
            errors.append("Published comparison labels do not match the source row")
        cell = cells[2 + (1, 2, 4, 8).index(row["gpus"])]
        if float(cell) != row["msPerStep"]:
            errors.append(f"Published comparison differs from README cell: {cell}")

    example = data["b200Example"]
    samples = example["samples"]
    for sample in samples:
        source = sample["source"]
        cells = blob_lines(sha, source["path"])[source["line"] - 1].split()
        wanted = (int(cells[0]), cells[1], int(cells[2]), int(cells[3]), float(cells[4]), cells[5])
        actual = tuple(sample[key] for key in ("gpus", "arm", "repetition", "returnCode", "msPerStep", "infoHash"))
        if actual != wanted:
            errors.append(f"Recorded sample differs from its source log: {source}")
    for summary in example["reportedMedians"]:
        selected = [sample for sample in samples if sample["gpus"] == summary["gpus"] and sample["returnCode"] == 0]
        median = statistics.median(sample["msPerStep"] for sample in selected)
        if len(selected) != summary["validLegs"] or abs(median - summary["msPerStep"]) > .000051:
            errors.append("B200 reported median disagrees with the recorded samples")
        if abs(172.8 / median - summary["nsPerDay"]) > .051:
            errors.append("B200 throughput disagrees with its 2 fs timestep and sample median")
    sample_keys = [(sample["gpus"], sample["arm"], sample["repetition"]) for sample in samples]
    expected_keys = {(gpus, arm, repetition) for gpus in (1, 2, 4) for arm in ("A", "C") for repetition in (1, 2, 3)}
    if len(sample_keys) != len(set(sample_keys)) or set(sample_keys) != expected_keys:
        errors.append("B200 example must include each of its 18 distinct recorded legs exactly once")
    return count


def verify_history(data, sha, errors):
    history = data["history"]
    repository = data["repository"]
    expected_history = git("rev-list", "--reverse", f"{repository['baseCommit']}..{sha}").splitlines()
    if [entry["sha"] for entry in history] != expected_history or repository["nativeCommitCount"] != len(history):
        errors.append("History does not match the commits between the documented base and source snapshot")
    for entry in history:
        commit = entry["sha"]
        metadata = git("show", "-s", "--format=%H%n%cs%n%s", commit).splitlines()
        if metadata != [commit, entry["date"], entry["subject"]] or not commit.startswith(entry["shortSha"]):
            errors.append(f"History commit metadata differs from Git: {commit}")
        if entry["url"] != f"{REPOSITORY}/commit/{commit}":
            errors.append(f"History commit URL is incorrect: {commit}")
        expected = {}
        for line in git("show", "--format=", "--numstat", commit).splitlines():
            added, deleted, path = line.split("\t", 2)
            expected[path] = (None if added == "-" else int(added), None if deleted == "-" else int(deleted))
        actual = {file["path"]: (file["added"], file["deleted"]) for file in entry["files"]}
        for file in entry["files"]:
            if file["url"] != f"{REPOSITORY}/blob/{commit}/{file['path']}":
                errors.append(f"History file URL disagrees with its commit/path: {file['path']}")
        if actual != expected or len(actual) != entry["filesChanged"]:
            errors.append(f"History file list or line counts differ from Git: {commit}")
        if (entry["additions"], entry["deletions"]) != tuple(sum(pair[position] or 0 for pair in expected.values()) for position in (0, 1)):
            errors.append(f"History aggregate changes differ from Git: {commit}")
    return len(history)


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if value and name in {"src", "href"}:
                self.references.append(value)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index-only", action="store_true", help="Check only the generated source index")
    args = parser.parse_args()
    index = read_index()
    errors = []
    if not re.fullmatch(r"[0-9a-f]{40}", index["commit"]):
        errors.append("Snapshot commit must be a full Git SHA")
    elif subprocess.run(
        ["git", "cat-file", "-e", index["commit"] + "^{commit}"], cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode:
        errors.append("Snapshot commit is not present in this repository")
    elif subprocess.run(
        ["git", "diff", "--quiet", index["commit"], "--", "src/spdyn"], cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode:
        errors.append("Working source differs from the indexed commit; commit source changes before regenerating links")

    if build_index(index["commit"]) != index:
        errors.append("Generated source index does not match the current src/spdyn files")

    source_lines = {}
    for file in index["files"]:
        path = ROOT / file["path"]
        if not path.is_file() or not path.resolve().is_relative_to(ROOT / "src/spdyn"):
            errors.append(f"Source file does not exist within src/spdyn: {file['path']}")
            continue
        if file["path"] not in tree_paths(index["commit"]):
            errors.append(f"Indexed file missing at pinned commit: {file['path']}")
        source_lines[file["path"]] = path.read_text(encoding="utf-8", errors="replace").splitlines()
    seen = set()
    for symbol in index["symbols"]:
        key = (symbol["path"], symbol["line"], symbol["name"], symbol["kind"])
        if key in seen:
            errors.append(f"Duplicate symbol entry: {key}")
        seen.add(key)
        lines = source_lines.get(symbol["path"], [])
        if not 1 <= symbol["line"] <= len(lines):
            errors.append(f"Invalid source line: {key}")
        elif not re.search(r"\b" + re.escape(symbol["name"]) + r"\b", lines[symbol["line"] - 1]):
            errors.append(f"Symbol is absent at its linked line: {key}")

    # Key boundaries must remain discoverable: host admission, ABI, context,
    # CUDA force execution, and native stepping are independent code paths.
    required = {
        ("src/spdyn/sp_gpu_core_step.fpp", "gpu_core_admit"),
        ("src/spdyn/sp_gpu_core.fpp", "gpu_core_setup"),
        ("src/spdyn/sp_gpu_core_abi.fpp", "gpu_core_create"),
        ("src/spdyn/gpu_core.cpp", "mul_checked"),
        ("src/spdyn/gpu_step.cu", "gcn_kern_reduce_finalize"),
    }
    indexed = {(symbol["path"], symbol["name"]) for symbol in index["symbols"]}
    for key in sorted(required - indexed):
        errors.append(f"Missing a key source boundary: {key}")
    if OUTPUT.stat().st_size > 500_000:
        errors.append("Source index exceeds the 500 KB static asset budget")

    asset_count = reference_count = history_count = 0
    if not args.index_only:
        try:
            architecture = load_data("source-map.js")
            measurements = load_data("measurements.js")
            reference_count += verify_architecture(architecture, index["commit"], errors)
            reference_count += verify_measurements(measurements, index["commit"], errors)
            history_count = verify_history(measurements, index["commit"], errors)
        except (OSError, ValueError, KeyError, IndexError, subprocess.CalledProcessError) as error:
            errors.append(f"Cannot validate curated data: {error}")
        html = ROOT / "docs/explorer/index.html"
        if not html.is_file():
            errors.append("Explorer entry point docs/explorer/index.html is missing")
        else:
            assets = AssetParser()
            assets.feed(html.read_text(encoding="utf-8"))
            for reference in assets.references:
                url = urlsplit(reference)
                if url.scheme or url.netloc or not url.path:
                    continue
                if url.path.startswith("/"):
                    errors.append(f"Root-relative link breaks GitHub project Pages: {reference}")
                    continue
                target = (html.parent / unquote(url.path)).resolve()
                if not target.exists():
                    errors.append(f"Missing relative HTML asset or link: {reference}")
                asset_count += 1
    if errors:
        raise SystemExit("Explorer validation failed:\n- " + "\n- ".join(errors))
    print(f"Explorer verified: {len(source_lines)} source files, {len(seen)} symbol links, "
          f"{reference_count} source excerpts/references, {history_count} Git commits, "
          f"{asset_count} relative HTML assets; snapshot {index['commit'][:7]}.")


if __name__ == "__main__":
    main()
