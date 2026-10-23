# GENESIS native GPU explorer

A static, dependency-free explorer for `wmarti/genesis-gpu-native`, inspired by the supplied graph layout. Open `index.html` directly, or serve this directory. The graph becomes readable cards in compact windows. Light and dark controls have distinct selected states, and the overview offers three visual entry points: CPU setup, GPU timesteps, and multi-GPU sharing. No account, server API, build, analytics, external font, or package install is required.

## Use

- Select a component to see its role, related components, and source files.
- Choose **Explore parts** for a guide to what the component reads and makes available. Parts are grouped by responsibility; select one for an excerpt, then choose **Read complete file** to continue in context. Previous/Next browses the selected component's parts. The top **Source** tab opens the full-file reader directly: browse all 149 files, find text within a file, jump to a line, toggle **Wrap lines**, or download the original source text.
- Browser Back/Forward restores views and exact source selections. **Share** copies a link to the current function, component, or performance comparison. Local previews explain that public links become available after publishing. The in-page back button goes up one level: source, parts, map, overview. **Map overview** restores the full map and its framing.
- Use **Find in source** or **Command/Ctrl K** to search 2,338 lexical symbols from 149 SPDYN files.
- In a wide window, drag cards or the canvas; scroll or use +/− to zoom. **Fit** frames the graph and **Reset** restores its layout. Laptop layouts show larger role labels, with descriptions in the inspector. Smaller windows use readable cards. **Start with setup** gives new visitors a clear entry point.
- **What changed** presents the eight original port commits and changed files.
- **Performance** compares recorded scaling, stock GENESIS performance, and validation. Select the simulation, GPU model, math precision and chart measure; unavailable choices are explained. The fastest configuration is selected by step time, and relative throughput is calculated from those timings before display rounding. All numbers link to the release evidence.
- The appearance button switches between light and dark. Only that preference is stored locally.

All 149 indexed SPDYN source files are included, totaling 221,490 lines and 8,018,794 original UTF-8 bytes (about 8 MB). A file is loaded only when opened. The complete local package works offline, including the source reader; it does not request code from GitHub or use the GitHub API. On the published site, unopened files are fetched from the same static site when needed. External evidence links still require an internet connection.

## Publish on GitHub Pages

The included `.github/workflows/explorer-pages.yml` validates this site and deploys this directory at the repository's Pages root.

The interactive explorer belongs on **GitHub Pages**, not inside the GitHub.com README. GitHub sanitizes rendered repository markup, including removal of script tags, so a README cannot run this JavaScript application or embed it as an interactive iframe. Keep the screenshot and link in the README. [GitHub's markup documentation](https://github.com/github/markup) describes that sanitization. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) hosts the HTML, CSS and JavaScript as a complete website.

The root README is prepared with links to [the explorer's Pages URL](https://wmarti.github.io/genesis-gpu-native/). Those links become usable after a successful Pages deployment; including them in this package does not mean the site has already been published.

1. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
2. Commit or merge the complete package into `main` in `wmarti/genesis-gpu-native`: `.gitattributes`, the root `README.md`, all of `docs/explorer/`, `doc/images/genesis-explorer-light.jpg`, `doc/images/genesis-explorer-dark.jpg`, the `scripts/*explorer*.py` files, `scripts/test_explorer_navigation.js`, and `.github/workflows/explorer-pages.yml`.
3. The push triggers **Actions → GENESIS explorer**. If needed, choose **Run workflow** on `main` to start it manually.
4. Wait for both the verification and deployment jobs to succeed. Open the deployment URL and check **How it works**, **What changed**, **Performance**, and a source link. The expected address is [wmarti.github.io/genesis-gpu-native](https://wmarti.github.io/genesis-gpu-native/) unless a custom Pages domain is configured. Use the actual deployment URL for the README links if it differs.
5. On the repository home page, open the gear beside **About**, enter the verified deployment URL in **Website**, and save. This adds a prominent explorer link beside the repository description.

The prepared README links open the [architecture map](https://wmarti.github.io/genesis-gpu-native/), [published performance](https://wmarti.github.io/genesis-gpu-native/#view=measurements), and [port history](https://wmarti.github.io/genesis-gpu-native/#view=movement). The explorer is served at the Pages root, with no additional `/explorer/` path.

The workflow has read-only source access in its verification job. Only the deployment job receives `pages: write` and `id-token: write`. Pull requests are checked but never deployed. There is no simulation build and no GPU runner requirement. The prepared workflow does not grant repository access: enabling Pages and pushing the package require the corresponding permissions on the GitHub account.

[GitHub documentation: using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Preview and verify

Open `docs/explorer/index.html` in a browser directly, or start a local server from the repository root:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory docs/explorer
```

Open [the local explorer](http://127.0.0.1:8765/). No CUDA build or GPU is required. The server keeps running until you press Ctrl+C.

To validate the package, use another terminal, or stop the server first. Run these commands from the repository root:

```sh
node --check docs/explorer/app.js
node --check docs/explorer/navigation.js
node --test scripts/test_explorer_navigation.js
python3 scripts/check_explorer.py
```

The tests require the full repository history because they verify original commit metadata and source references. The standard Python check also validates every complete source file against the pinned Git blob, including its exact UTF-8 text, path, byte count, SHA-256 hash and line count. It checks the safe generated JavaScript wrapper without executing source code. CI additionally syntax-checks all application and lazy source JavaScript assets in one Node process.

## Source and evidence

- Source snapshot: `34f4a37ced7b1db375beaac87b867ea7d0ac5563`.
- `source-map.js` contains eight curated responsibilities, 48 source excerpts and 13 evidenced relationships. This is not a complete compiler-derived call graph or execution trace.
- `component-guide.js` groups all 48 definitions into reading guides, with context and conditional paths. Groups do not represent an execution sequence.
- `source-index.js` contains a lexical inventory, including interface declarations. File line counts include comments and blank lines. Symbol counts are not test coverage.
- `source-manifest.js` pins the same snapshot and maps every indexed path to its file asset, language, line count, original byte count and SHA-256 hash. `source-files/*.js` contains the complete UTF-8 files as JSON strings in small registration wrappers. The viewer displays the strings as source text; it does not execute the Fortran, C, C++ or CUDA code. Preserve the whole directory when copying or publishing the explorer.
- `measurements.js` transcribes published release results and history. Benchmarks were **not rerun** for this website. The native measurements identify source `29292944` and release documentation tip `218b65ff`; current source history ends at the replacement documentation commit `34f4a37`. These are not sequential release commits.
- Kernel-specific timings are not provided because the committed evidence does not supply them.
- The detailed benchmark table gives 53 ns/day for the tuned four-GPU RTX 3090 case; the hero image alt text rounds it differently. The explorer follows the table.

To rebuild the complete source bundle at the currently indexed snapshot:

```sh
python3 scripts/build_explorer_sources.py
python3 scripts/build_explorer_sources.py --check
python3 scripts/check_explorer.py
```

The source generator reads the exact Git commit recorded in `source-index.js`, rather than HEAD or working-tree source files. For a deliberate snapshot update, first regenerate the lexical index with `python3 scripts/build_explorer_index.py`, then rebuild the source bundle with the commands above. Update the curated map, component guides and benchmark provenance deliberately; the validator rejects mismatched snapshots, snippets, table values and commit statistics. It does not silently rewrite historical measurements.

The source files and excerpts come from GENESIS and retain the repository's LGPL-3.0 licensing; see `LICENSE`, `COPYING` and `AUTHORS` in this directory and the linked original files. Complete bundled files preserve their original notices.
