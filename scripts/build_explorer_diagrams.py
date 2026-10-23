#!/usr/bin/env python3
"""Build linked README cards and sync the full interactive architecture diagram."""
from __future__ import annotations

import argparse
from html import escape
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "docs/explorer"
PUBLIC = "https://wmarti.github.io/genesis-gpu-native/"
CARDS = [
    ("bridge", "HOST · SETUP", ["Start a", "simulation"], "Read inputs and select the native path"),
    ("state", "GPU · STATE", ["Keep atoms", "on the GPU"], "Hold coordinates, velocities and forces"),
    ("integrator", "GPU · MOTION", ["Advance", "the motion"], "Integrate, constrain and control temperature"),
    ("neighbors", "GPU · NEIGHBORS", ["Find nearby", "atoms"], "Build the list of interacting pairs"),
    ("forces", "GPU · FORCES", ["Calculate", "local forces"], "Evaluate nearby interactions and bonds"),
    ("pme", "GPU · ELECTROSTATICS", ["Solve long-range", "forces"], "Compute electrostatics with PME and FFTs"),
    ("domains", "MULTI-GPU · BOUNDARIES", ["Share", "the boundaries"], "Exchange edge atoms and their forces"),
    ("transport", "MULTI-GPU · COMMUNICATION", ["Connect", "the GPUs"], "Move data through peer copies or MPI"),
]

def data(name):
    return json.loads((SITE / name).read_text().split(" = ", 1)[1].strip().removesuffix(";"))

def card_svg(category, title, description):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="400" height="178" viewBox="0 0 400 178" role="img" aria-labelledby="title desc">
<title id="title">{escape(' '.join(title))}</title><desc id="desc">{escape(description)}. Open the component and its source code.</desc>
<style>
.card{{fill:#f7f9f8;stroke:#dce4e0}} .title{{fill:#26352e}} .muted{{fill:#617168}} .accent{{fill:#476e5b}}
@media(prefers-color-scheme:dark){{.card{{fill:#272c2a;stroke:#454d49}}.title{{fill:#f1f5f2}}.muted{{fill:#bac5be}}.accent{{fill:#b7d6c4}}}}
text{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}}
</style>
<rect class="card" x="1" y="1" width="398" height="176" rx="18"/>
<text class="accent" x="22" y="29" font-size="10" font-weight="600" letter-spacing="1.2">{escape(category)}</text>
<text class="title" x="22" y="64" font-size="25" font-weight="600">{escape(title[0])}</text>
<text class="title" x="22" y="94" font-size="25" font-weight="600">{escape(title[1])}</text>
<text class="muted" x="22" y="124" font-size="13">{escape(description)}</text>
<text class="accent" x="22" y="155" font-size="12" font-weight="600">Explore component &amp; code →</text>
<text class="accent" x="365" y="87" font-size="28" text-anchor="middle">↗</text>
</svg>
'''

def replace_region(text, start, end, content):
    if text.count(start) != 1 or text.count(end) != 1:
        raise ValueError(f"Expected exactly one {start} and {end}")
    before, rest = text.split(start, 1)
    _, after = rest.split(end, 1)
    return before + start + "\n" + content.rstrip() + "\n" + end + after

def outputs():
    architecture = data("source-map.js")
    guides = data("component-guide.js")["components"]
    components = {c["id"]: c for c in architecture["components"]}
    generated = {}
    cells = []
    for key, category, title, description in CARDS:
        featured = guides[key]["featured"]
        assert any(f["id"] == featured for f in components[key]["functions"])
        filename = f"doc/images/explorer-components/{key}.svg"
        generated[ROOT / filename] = card_svg(category, title, description)
        url = escape(f"{PUBLIC}#component={key}&function={featured}", quote=True)
        label = escape(" ".join(title) + " — open component and source code", quote=True)
        cells.append(f'<a href="{url}"><img src="{filename}" width="400" alt="{label}"></a>')
    table = '<p align="center">\n' + "\n".join(cells) + "\n</p>"
    readme = ROOT / "README.md"
    generated[readme] = replace_region(readme.read_text(), "<!-- BEGIN EXPLORER COMPONENTS -->", "<!-- END EXPLORER COMPONENTS -->", table)
    svg = (ROOT / "doc/images/gpu-native-architecture.svg").read_text()
    root = ET.fromstring(svg)
    links = root.findall("{http://www.w3.org/2000/svg}a")
    assert len(links) == 11, "Every original diagram block must link to source"
    for link in links:
        assert link.attrib["href"].startswith(PUBLIC + "#component=")
        params = parse_qs(urlsplit(link.attrib["href"]).fragment)
        component = components[params["component"][0]]
        assert any(f["id"] == params["function"][0] for f in component["functions"]), link.attrib["href"]
    page = SITE / "architecture.html"
    generated[page] = replace_region(page.read_text(), "<!-- BEGIN ARCHITECTURE SVG -->", "<!-- END ARCHITECTURE SVG -->", svg)
    return generated

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    for path, content in outputs().items():
        if args.check:
            if not path.exists() or path.read_text() != content:
                raise SystemExit(f"Out-of-date diagram asset: {path.relative_to(ROOT)}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
    print("Verified 8 linked README blocks and 11 interactive diagram blocks" if args.check else "Built linked architecture diagrams")

if __name__ == "__main__":
    main()
