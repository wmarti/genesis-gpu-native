# GENESIS native GPU explorer

A static, dependency-free explorer for `wmarti/genesis-gpu-native`, inspired by the supplied graph layout. Open `index.html` directly, or serve this directory. The graph becomes readable cards in compact windows. No account, server API, build, analytics, external font, or package install is required.

## Use

- Select a component to see its role, related components, and source files.
- Choose **Explore parts** to inspect selected definitions, then select a part to read its actual source excerpt.
- Use **Find in source** or **Command/Ctrl K** to search 2,338 lexical symbols from 149 SPDYN files.
- In a wide window, drag cards or the canvas; scroll or use +/− to zoom. **Fit** frames the graph and **Reset** restores its layout.
- **Code movement** presents the eight original port commits and changed files.
- **Measurements** compares recorded scaling, stock GENESIS performance, and validation. Select the simulation, precision, hardware and unit; unavailable combinations are omitted. All numbers link to the release evidence.
- The appearance button switches between light and dark. Only that preference is stored locally.

## Publish on GitHub Pages

The included `.github/workflows/explorer-pages.yml` validates this site and deploys this directory at the repository's Pages root.

1. Commit the explorer, both `scripts/*explorer*.py` files, and the workflow to `main` in `wmarti/genesis-gpu-native` (or merge a branch containing them).
2. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**. Repository administrator access is required to change this setting.
3. In **Actions → GENESIS explorer**, choose **Run workflow** on `main`, or push a change to one of the tracked explorer paths.
4. After the deploy job succeeds, the site will be at `https://wmarti.github.io/genesis-gpu-native/` unless the repository has a custom Pages domain.

The workflow has read-only source access in its verification job. Only the deployment job receives `pages: write` and `id-token: write`. Pull requests are checked but never deployed. There is no simulation build and no GPU runner requirement.

GitHub documentation: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

## Preview and verify

From the repository root:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory docs/explorer
node --check docs/explorer/app.js
python3 scripts/check_explorer.py
```

Open `http://127.0.0.1:8765/`. The tests require the full repository history because they verify original commit metadata and source references.

## Source and evidence

- Source snapshot: `34f4a37ced7b1db375beaac87b867ea7d0ac5563`.
- `source-map.js` contains eight curated responsibilities, 48 source excerpts and 13 evidenced relationships. This is not a complete compiler-derived call graph or execution trace.
- `source-index.js` contains a lexical inventory, including interface declarations. File line counts include comments and blank lines. Symbol counts are not test coverage.
- `measurements.js` transcribes published release results and history. Benchmarks were **not rerun** for this website. The native measurements identify source `29292944` and release documentation tip `218b65ff`; current source history ends at the replacement documentation commit `34f4a37`. These are not sequential release commits.
- Kernel-specific timings are not provided because the committed evidence does not supply them.
- The detailed benchmark table gives 53 ns/day for the tuned four-GPU RTX 3090 case; the hero image alt text rounds it differently. The explorer follows the table.

To regenerate the lexical index at a new snapshot, run `python3 scripts/build_explorer_index.py`. Update the curated map and benchmark provenance deliberately; the validator will reject mismatched source snapshots, snippets, table values and commit statistics. It does not silently rewrite historical measurements.

The source excerpts come from GENESIS and retain the repository's LGPL-3.0 licensing; see `LICENSE`, `COPYING` and `AUTHORS` in this directory and the linked original files.
