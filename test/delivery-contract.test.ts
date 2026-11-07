// Delivery-contract tests — lock the published artifact form that keeps the
// plugin alive on the real host (pitfalls #13/#14/#15/#16). These guard the
// packaging decisions themselves, so a future edit cannot silently regress
// them:
//   1. package.json: "./tui" points at the precompiled bundle (raw TSX
//      entries fail stage=load on the host — pitfall #16), zero
//      @opentui/solid-js dependency declarations (parasite copies — #13/#14),
//      flat semver only (prerelease suffixes hang `plugin update` — #15).
//   2. dist/tui.js: single-file bundle, every import is a host-provided bare
//      external, default export intact, no machine-local path leakage.
//   3. src posture: bare specifiers only (solid-js dist subpaths are not
//      proven under the host alias — 0.7.24 verdict), every .tsx carries the
//      @opentui/solid jsxImportSource pragma (esbuild falls back to react
//      otherwise), no createRoot call anywhere (OMO ambient mount pattern).
//   4. staleness sentinel: rebuild the TUI entry via the package build
//      script into a temp file and byte-compare against the committed
//      dist/tui.js — "edited src/, forgot npm run build:tui" fails here.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir, userInfo } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const testDirectory = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(testDirectory, "..")
const srcRoot = join(repoRoot, "src")
const distEntryPath = join(repoRoot, "dist", "tui.js")

const readUtf8 = (path: string): string => readFileSync(path, "utf8")

// Comment-free source so prose mentions of imports/createRoot in doc blocks
// do not trigger the posture checks below. The single implementation is the
// string-aware state machine (stripComponentComments) further down — the old
// regex version stripped block comments first, so a `//` comment mentioning a
// path like `sidebar/*)` opened a phantom block comment and silently swallowed
// most of sidebar-metrics.tsx, disabling the posture checks for that file.

// Bare specifiers the host serves to plugin TUI code as runtime modules.
// Anything outside this set must resolve on disk or be bundled.
const isHostProvidedSpecifier = (specifier: string): boolean => {
  if (specifier.startsWith("node:")) return true
  if (specifier.startsWith("@opencode/plugin")) return true
  if (specifier.startsWith("@opentui/solid")) return true
  if (specifier === "solid-js" || specifier === "solid-js/store") return true
  return false
}

const collectImportSpecifiers = (source: string): string[] => {
  const specifiers = new Set<string>()
  for (const line of source.split("\n")) {
    const staticImport = line.match(/^\s*import\b[^'"`]*?["']([^"']+)["']/)
    if (staticImport) specifiers.add(staticImport[1])
    const dynamicImport = line.match(/import\(\s*["']([^"']+)["']/)
    if (dynamicImport) specifiers.add(dynamicImport[1])
  }
  return [...specifiers]
}

const listSourceFiles = (directory: string): string[] => {
  const collected: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      collected.push(...listSourceFiles(entryPath))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      collected.push(entryPath)
    }
  }
  return collected
}

// --- package.json contract ---------------------------------------------------

const packageJson = JSON.parse(readUtf8(join(repoRoot, "package.json"))) as {
  version: string
  type: string
  exports: Record<string, string>
  scripts: Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

test("package.json: the tui export points at the precompiled bundle, not raw src", () => {
  assert.equal(packageJson.exports["./tui"], "./dist/tui.js")
  assert.equal(packageJson.exports["."], "./src/index.ts")
})

test("package.json: version is flat semver (prerelease suffixes hang plugin update)", () => {
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/)
})

test("package.json: package stays ESM", () => {
  assert.equal(packageJson.type, "module")
})

test("package.json: no @opentui/solid-js dependency declarations anywhere (parasite copies)", () => {
  for (const section of [
    "dependencies",
    "peerDependencies",
    "devDependencies",
    "optionalDependencies",
  ] as const) {
    const entries = packageJson[section] ?? {}
    for (const name of Object.keys(entries)) {
      assert.ok(
        !name.startsWith("@opentui/") && name !== "solid-js" && !name.startsWith("solid-js/"),
        `${section} declares "${name}" — host-provided runtime modules must stay undeclared (pitfall #14)`,
      )
    }
  }
})

test("package.json: @opencode/plugin stays declared as a real dependency", () => {
  assert.ok(packageJson.dependencies?.["@opencode/plugin"])
})

// --- dist/tui.js artifact contract --------------------------------------------

test("dist/tui.js exists and is a non-trivial bundle", () => {
  assert.ok(existsSync(distEntryPath), "dist/tui.js missing — run npm run build:tui and commit it")
  assert.ok(readFileSync(distEntryPath).length > 10_000)
})

test("dist/tui.js: every import is a host-provided bare external (no relative or bundled-away leftovers)", () => {
  const specifiers = collectImportSpecifiers(readUtf8(distEntryPath))
  assert.ok(specifiers.length > 0, "bundle imports nothing — suspicious")
  for (const specifier of specifiers) {
    assert.ok(
      isHostProvidedSpecifier(specifier),
      `dist/tui.js imports "${specifier}" — the host only serves runtime modules at entry level; ` +
        `unexpected specifiers must be bundled or declared (pitfall #16)`,
    )
  }
  const requiredExternals = ["solid-js", "@opentui/solid", "@opentui/solid/jsx-runtime", "@opencode/plugin/tui"]
  for (const required of requiredExternals) {
    assert.ok(
      specifiers.includes(required),
      `dist/tui.js no longer imports "${required}" — the reactive mount posture changed; ` +
        `update this contract deliberately (pitfall #13)`,
    )
  }
})

test("dist/tui.js: default export survived bundling", () => {
  const bundleSource = readUtf8(distEntryPath)
  assert.match(bundleSource, /export\s*\{[^}]*as\s+default[^}]*\}/)
})

test("dist/tui.js: no machine-local path leakage inside the bundle", () => {
  const bundleSource = readUtf8(distEntryPath)
  assert.ok(!/[A-Za-z]:[\\/](Users|workSpace)/.test(bundleSource), "absolute paths leaked into the artifact")
  // Read the running machine's account name instead of hard-coding it: the
  // assertion still guards this checkout (where the leak would originate) but
  // the repo no longer publishes one machine's username.
  const localAccountName = userInfo().username
  if (localAccountName.length >= 3) {
    assert.ok(
      !bundleSource.includes(localAccountName),
      "local username leaked into the artifact",
    )
  }
})

// --- src posture contract ------------------------------------------------------

test("src: every non-relative import is a bare host-provided specifier (no dist subpaths)", () => {
  for (const sourcePath of listSourceFiles(srcRoot)) {
    const strippedSource = stripComponentComments(readUtf8(sourcePath))
    for (const specifier of collectImportSpecifiers(strippedSource)) {
      if (specifier.startsWith(".") || specifier.startsWith("/")) continue
      assert.ok(
        isHostProvidedSpecifier(specifier),
        `${sourcePath} imports "${specifier}" — src must only use bare host-provided specifiers ` +
          `(solid-js/dist/* subpaths are not proven under the host alias; pitfall #13/#14)`,
      )
    }
  }
})

test("src: every .tsx file declares the @opentui/solid jsxImportSource pragma on line 1", () => {
  for (const sourcePath of listSourceFiles(srcRoot)) {
    if (!sourcePath.endsWith(".tsx")) continue
    const firstLine = readUtf8(sourcePath).split("\n")[0]
    assert.equal(
      firstLine,
      "/** @jsxImportSource @opentui/solid */",
      `${sourcePath} — esbuild falls back to react/jsx-runtime without the pragma`,
    )
  }
})

test("src: no createRoot call anywhere (ambient OMO mount is the settled posture)", () => {
  for (const sourcePath of listSourceFiles(srcRoot)) {
    const strippedSource = stripComponentComments(readUtf8(sourcePath))
    assert.ok(
      !/createRoot\s*\(/.test(strippedSource),
      `${sourcePath} calls createRoot — detached roots lose RendererContext ` +
        `("No renderer found", pitfall #13 0.7.22/0.7.23 real-machine crashes)`,
    )
  }
})

// --- staleness sentinel ----------------------------------------------------------

test("dist/tui.js is byte-identical to a rebuild via the package build script", () => {
  const buildCommand = packageJson.scripts["build:tui"]
  assert.ok(buildCommand, "package.json scripts.build:tui must exist")
  const tempBundlePath = join(tmpdir(), "usage-meter-tui-staleness-check.js")
  const tempBuildCommand = buildCommand.replace(
    "--outfile=dist/tui.js",
    `--outfile=${JSON.stringify(tempBundlePath)}`,
  )
  try {
    execFileSync(tempBuildCommand, {
      cwd: repoRoot,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const rebuilt = readFileSync(tempBundlePath)
    const committed = readFileSync(distEntryPath)
    assert.ok(
      rebuilt.equals(committed),
      "dist/tui.js is stale — run `npm run build:tui` and commit the rebuilt artifact",
    )
  } finally {
    rmSync(tempBundlePath, { force: true })
  }
})

// --- .tsx integration invariants (real-machine only) ---------------------------
// test-loader.mjs cannot import .tsx (it holds JSX), so the render-chain fixes
// that only manifest on the real host can be pinned only by reading the
// component source. These assert structure, not formatting: the regexes stay
// loose enough to survive unrelated refactors.

// The single comment stripper for every source-posture assertion in this file.
// It consumes `//` line comments before treating a `/` as a block comment, so a
// line comment that mentions a path like `sidebar/*)` cannot open a phantom
// block comment and swallow half the file (the old regex version did exactly
// that to sidebar-metrics.tsx, silently disabling its posture checks). Strings
// and template literals are carried through untouched.
const stripComponentComments = (source: string): string => {
  let result = ""
  let index = 0
  while (index < source.length) {
    const character = source[index]
    const following = source[index + 1]
    if (character === '"' || character === "'" || character === "`") {
      result += character
      index += 1
      while (index < source.length && source[index] !== character) {
        result += source[index]
        if (source[index] === "\\") {
          index += 1
          result += source[index] ?? ""
        }
        index += 1
      }
      if (index < source.length) {
        result += source[index]
        index += 1
      }
      continue
    }
    if (character === "/" && following === "/") {
      while (index < source.length && source[index] !== "\n") index += 1
      continue
    }
    if (character === "/" && following === "*") {
      index += 2
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1
      }
      index += 2
      continue
    }
    result += character
    index += 1
  }
  return result
}

// Text between the parentheses of the first `callee(` call, balanced so nested
// calls/arrow args do not truncate early. Undefined when the call is absent.
const readCallArgumentText = (source: string, callee: string): string | undefined => {
  const callIndex = source.indexOf(`${callee}(`)
  if (callIndex === -1) return undefined
  const openIndex = callIndex + callee.length
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index]
    if (character === "(") depth += 1
    else if (character === ")") {
      depth -= 1
      if (depth === 0) return source.slice(openIndex + 1, index)
    }
  }
  return undefined
}

// Split a call's argument text on its top-level commas (bracket/brace/paren
// aware), so `a, () => foo(b, c), now` yields three trimmed arguments. Used to
// pin argument positions, not just presence.
const splitCallArguments = (argumentText: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < argumentText.length; index += 1) {
    const character = argumentText[index]
    if (character === "(" || character === "{" || character === "[") depth += 1
    else if (character === ")" || character === "}" || character === "]") depth -= 1
    else if (character === "," && depth === 0) {
      parts.push(argumentText.slice(start, index).trim())
      start = index + 1
    }
  }
  const tail = argumentText.slice(start).trim()
  if (tail.length > 0) parts.push(tail)
  return parts
}

// Index of the first `return` statement at the top level of the function whose
// body starts at `functionStart` (brace-depth aware, string/template aware), or
// -1 if the body has none. Used to prove a component body always returns JSX.
const findFirstTopLevelReturnIndex = (source: string, functionStart: number): number => {
  const arrowIndex = source.indexOf("=> {", functionStart)
  if (arrowIndex === -1) return -1
  const bodyOpenIndex = source.indexOf("{", arrowIndex)
  let depth = 0
  for (let index = bodyOpenIndex; index < source.length; index += 1) {
    const character = source[index]
    if (character === '"' || character === "'" || character === "`") {
      index += 1
      while (index < source.length && source[index] !== character) {
        if (source[index] === "\\") index += 1
        index += 1
      }
      continue
    }
    if (character === "{") {
      depth += 1
    } else if (character === "}") {
      depth -= 1
      if (depth === 0) return -1
    } else if (depth === 1 && source.startsWith("return", index)) {
      const characterBefore = source[index - 1]
      const characterAfter = source[index + 6]
      if (!/[A-Za-z0-9_$]/.test(characterBefore ?? "") && !/[A-Za-z0-9_$]/.test(characterAfter ?? "")) {
        return index
      }
    }
  }
  return -1
}

test("src .tsx: dim text runs pass 0 (not undefined) as the attributes value", () => {
  for (const componentFileName of ["footer-status.tsx", "sidebar-metrics.tsx"]) {
    const componentSource = stripComponentComments(
      readUtf8(join(srcRoot, "components", componentFileName)),
    )
    assert.match(
      componentSource,
      /\?\s*DIM_TEXT_ATTRIBUTE\s*:\s*0\b/,
      `${componentFileName} must pass 0 as the non-dim attributes value — the host stores ` +
        `props verbatim and an undefined would pollute the text buffer's default attributes`,
    )
  }
})

test("sidebar-metrics.tsx (B1): the visibility memo passes the now tick to shouldShowSidebarBlock", () => {
  const componentSource = stripComponentComments(
    readUtf8(join(srcRoot, "components", "sidebar-metrics.tsx")),
  )
  const callArguments = readCallArgumentText(componentSource, "shouldShowSidebarBlock")
  assert.ok(callArguments !== undefined, "sidebar-metrics.tsx must call shouldShowSidebarBlock()")
  const callArgumentList = splitCallArguments(callArguments ?? "")
  assert.ok(
    callArgumentList.length >= 3,
    "shouldShowSidebarBlock takes three arguments (sidebarMetricsEnabled, readState, readTick)",
  )
  assert.equal(
    callArgumentList[2],
    "now",
    "the third argument must be the now tick — a reordered call, or an early disabled-return " +
      "that skips the tick read, re-introduces B1 (the memo drops its now() dependency and the " +
      "off->on flip never recomputes the block back to visible on a non-reactive host)",
  )
})

test("footer-status.tsx (B3): the component body always returns <box>; the !sessionID gate lives in the memo", () => {
  const componentSource = stripComponentComments(
    readUtf8(join(srcRoot, "components", "footer-status.tsx")),
  )
  const componentStart = componentSource.indexOf("const FooterStatus = (")
  assert.ok(componentStart !== -1, "could not locate the FooterStatus component body")
  const firstTopLevelReturnIndex = findFirstTopLevelReturnIndex(componentSource, componentStart)
  assert.ok(firstTopLevelReturnIndex !== -1, "FooterStatus must return a value")
  assert.match(
    componentSource.slice(firstTopLevelReturnIndex, firstTopLevelReturnIndex + 40),
    /^return\s*\(\s*<box/,
    "the component body's first top-level return must be the JSX <box> — a top-level " +
      "`if (!sessionID) return null` re-introduces B3 (createComponent runs the body inside " +
      "untrack, so the row freezes blank whenever the first frame has no session yet)",
  )
  assert.ok(
    componentSource.includes("if (!sessionID) return null"),
    "the !sessionID gate must remain, moved into the tracked memo so the tick can heal a late id",
  )
})
