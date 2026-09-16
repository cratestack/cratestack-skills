#!/usr/bin/env node
// Validates every skill in skills/ without installing anything.
// Run: node scripts/validate-skills.mjs
//
// Checks, in order of how often they actually break:
//   1. SKILL.md exists, has YAML frontmatter with `name` and `description`
//   2. `name` equals the directory name and is lowercase-kebab
//   3. `description` is present, single-line-ish, and under the 1024-char
//      budget agents allocate to skill descriptions
//   4. every relative link in the body resolves to a real file
//   5. every skill appears in COVERAGE.md, and COVERAGE.md names no skill
//      that does not exist (this is what keeps the parity table honest)

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillsDir = join(root, 'skills')

const errors = []
const warnings = []
const versions = new Set()
const fail = (skill, msg) => errors.push(`${skill}: ${msg}`)
const warn = (skill, msg) => warnings.push(`${skill}: ${msg}`)

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const DESCRIPTION_MAX = 1024

/** Minimal frontmatter reader — no YAML dependency, so CI needs nothing. */
function parseFrontmatter(text, skill) {
  if (!text.startsWith('---\n')) {
    fail(skill, 'SKILL.md does not start with a `---` frontmatter block')
    return null
  }
  const end = text.indexOf('\n---\n', 3)
  if (end === -1) {
    fail(skill, 'frontmatter block is never closed with `---`')
    return null
  }
  const block = text.slice(4, end)
  const out = {}
  let key = null
  for (const line of block.split('\n')) {
    if (/^\s/.test(line) && key) {
      out[key] += ' ' + line.trim()
      continue
    }
    const m = line.match(/^([A-Za-z0-9_.]+):\s*(.*)$/)
    if (!m) continue
    key = m[1]
    out[key] = m[2]
  }
  for (const k of Object.keys(out)) {
    out[k] = out[k].replace(/^["']|["']$/g, '').trim()
  }
  return { data: out, body: text.slice(end + 5) }
}

function checkLinks(body, skillPath, skill) {
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g
  let m
  while ((m = linkRe.exec(body))) {
    const target = m[1].split('#')[0].trim()
    if (!target) continue
    if (/^(https?:|mailto:|#)/.test(target)) continue
    const abs = resolve(skillPath, target)
    if (!existsSync(abs)) fail(skill, `broken relative link: ${target}`)
  }
}

const skills = readdirSync(skillsDir)
  .filter((d) => !d.startsWith('.'))
  .filter((d) => statSync(join(skillsDir, d)).isDirectory())
  .sort()

if (skills.length === 0) {
  console.error('no skills found under skills/')
  process.exit(1)
}

for (const skill of skills) {
  const dir = join(skillsDir, skill)
  const file = join(dir, 'SKILL.md')
  if (!existsSync(file)) {
    fail(skill, 'directory has no SKILL.md')
    continue
  }
  const parsed = parseFrontmatter(readFileSync(file, 'utf8'), skill)
  if (!parsed) continue
  const { data, body } = parsed

  if (!data.name) fail(skill, 'frontmatter has no `name`')
  else if (data.name !== skill)
    fail(skill, `frontmatter name "${data.name}" != directory name "${skill}"`)
  else if (!NAME_RE.test(data.name))
    fail(skill, `name "${data.name}" is not lowercase-kebab`)

  if (!data.description) fail(skill, 'frontmatter has no `description`')
  else {
    if (data.description.length > DESCRIPTION_MAX)
      fail(skill, `description is ${data.description.length} chars (max ${DESCRIPTION_MAX})`)
    if (data.description.length < 40)
      warn(skill, 'description is very short — it is the only thing an agent reads when deciding to load the skill')
  }

  if (body.trim().length < 200) warn(skill, 'body is suspiciously short')

  // Every skill must state which CrateStack version it was verified against.
  // A skill with no version provenance is the failure mode this repo exists to
  // avoid: an agent reads it as timeless, and writes code against a surface that
  // shipped two releases ago or has not shipped at all.
  const verified = body.match(/Verified against CrateStack (\d+\.\d+\.\d+)/)
  if (!verified) {
    fail(skill, 'body has no "Verified against CrateStack X.Y.Z" line')
  } else {
    versions.add(verified[1])
  }

  checkLinks(body, dir, skill)
}

// COVERAGE.md must account for every skill, both ways.
const coveragePath = join(root, 'COVERAGE.md')
if (!existsSync(coveragePath)) {
  errors.push('COVERAGE.md: missing')
} else {
  const coverage = readFileSync(coveragePath, 'utf8')
  for (const skill of skills) {
    if (!coverage.includes(skill)) errors.push(`COVERAGE.md: does not mention skill "${skill}"`)
  }
  const mentioned = [...coverage.matchAll(/skills\/([a-z0-9-]+)\//g)].map((m) => m[1])
  for (const name of new Set(mentioned)) {
    if (!skills.includes(name)) errors.push(`COVERAGE.md: references skill "${name}" that does not exist`)
  }
}

// One repo, one verified-against version. Skills drift apart silently otherwise:
// a reader has no way to tell that the schema skill was re-checked last release
// and the client skill three releases ago.
if (versions.size > 1) {
  errors.push(
    `skills disagree on the verified version: ${[...versions].sort().join(', ')} — re-verify and align them`,
  )
}

for (const w of warnings) console.warn(`warn  ${w}`)
for (const e of errors) console.error(`ERROR ${e}`)

console.log(`\n${skills.length} skills checked, ${errors.length} errors, ${warnings.length} warnings`)
process.exit(errors.length > 0 ? 1 : 0)
