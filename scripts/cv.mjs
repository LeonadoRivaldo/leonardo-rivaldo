import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import MarkdownIt from 'markdown-it'
import PDFDocument from 'pdfkit'
import {
  BorderStyle,
  Document,
  Footer,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const DOCS = join(ROOT, 'src', 'docs')
const EXPERIENCES = join(DOCS, 'experiencias')
const CV_DOCX = join(ROOT, 'artifacts', 'LR - consolidated.docx')
const CV_PDF = join(DOCS, 'public', 'LR - consolidated.pdf')
const BUILD_LOCK = join(ROOT, '.cv-build.lock')
const INDEX_PATH = join(EXPERIENCES, 'index.md')
const EXPERIENCE_SIDEBAR = join(DOCS, '.vitepress', 'experiences.generated.mjs')
const INDEX_START = '<!-- generated-experiences:start -->'
const INDEX_END = '<!-- generated-experiences:end -->'
const MONTHS = new Map([
  ['january', 1], ['february', 2], ['march', 3], ['april', 4],
  ['may', 5], ['june', 6], ['july', 7], ['august', 8],
  ['september', 9], ['october', 10], ['november', 11], ['december', 12],
])
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false })

function parseSections(source) {
  const sections = new Map()
  let current = null

  for (const line of source.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*#*\s*$/)
    if (heading) {
      current = heading[1].trim()
      sections.set(current, [])
      continue
    }

    if (/^#\s+/.test(line)) {
      current = null
      continue
    }

    if (current) {
      sections.get(current).push(line)
    }
  }

  return sections
}

function inlineText(source) {
  const inline = markdown.parseInline(source, {})[0]
  return (inline?.children ?? [])
    .map((token) => {
      if (token.type === 'text' || token.type === 'code_inline') return token.content
      if (token.type === 'image') return token.attrGet('alt') ?? ''
      if (token.type === 'softbreak' || token.type === 'hardbreak') return ' '
      return ''
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function paragraphs(lines = []) {
  return lines
    .join('\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block && !/^<!--/.test(block) && !/^[-*+]\s/.test(block))
    .map((block) => inlineText(block.replace(/\s*\n\s*/g, ' ')))
    .filter(Boolean)
}

function listItems(lines = []) {
  const items = []
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/)
    if (bullet) {
      items.push(inlineText(bullet[1]))
    } else if (/^\s{2,}\S/.test(line) && items.length) {
      items[items.length - 1] = `${items.at(-1)} ${inlineText(line.trim())}`
    }
  }
  return items.filter(Boolean)
}

function getSection(sections, name) {
  return sections.get(name) ?? []
}

function getField(source, name, file) {
  const expression = new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+)$`, 'mi')
  const value = source.match(expression)?.[1]?.trim()
  if (!value) throw new Error(`${file} is missing the ${name} field.`)
  return value
}

export function getPeriodSortKey(period) {
  const start = period.match(/^(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+)?(\d{4})\b/i)
  if (!start) throw new Error(`Unsupported experience period: ${period}`)
  const year = Number(start[2])
  const month = start[1] ? MONTHS.get(start[1].toLowerCase()) : 1
  return year * 12 + month
}

function experienceFromSource(file, source) {
  const parsed = matter(source)
  const sections = parseSections(parsed.content)
  const slug = basename(file, '.md')
  const title = String(parsed.data.title ?? parsed.content.match(/^#\s+(.+)$/m)?.[1] ?? slug).trim()
  const role = getField(parsed.content, 'Role', file)
  const period = getField(parsed.content, 'Period', file)
  const location = getField(parsed.content, 'Location', file)
  const contributions = listItems(getSection(sections, 'My contribution'))
  const experience = {
    slug,
    title,
    role,
    period,
    location,
    sortKey: getPeriodSortKey(period),
    projectContext: paragraphs(getSection(sections, 'Project context'))[0] ?? '',
    contributions,
    technologies: listItems(getSection(sections, 'Technologies and skills')),
  }

  if (!experience.projectContext || !experience.contributions.length || !experience.technologies.length) {
    throw new Error(`${file} is missing project context, contribution bullets, or technologies.`)
  }

  return experience
}

async function loadExperiences() {
  const { readdir } = await import('node:fs/promises')
  const files = (await readdir(EXPERIENCES))
    .filter((file) => file.endsWith('.md') && file !== 'index.md')
  const records = await Promise.all(files.map(async (file) => {
    const source = await readFile(join(EXPERIENCES, file), 'utf8')
    return experienceFromSource(file, source)
  }))

  return records.sort((left, right) => left.sortKey - right.sortKey || left.title.localeCompare(right.title))
}

async function syncExperienceIndex(experiences) {
  const source = await readFile(INDEX_PATH, 'utf8')
  const start = source.indexOf(INDEX_START)
  const end = source.indexOf(INDEX_END)
  if (start < 0 || end < start) {
    throw new Error('Experience index is missing its generated-list markers.')
  }

  const list = experiences.map((experience) => (
    `- **[${experience.title}](/experiencias/${experience.slug})** — ${experience.role}  \n  ${experience.period} · ${experience.location}`
  )).join('\n\n')
  const replacement = `${INDEX_START}\n\n${list}\n\n${INDEX_END}`
  const updated = `${source.slice(0, start)}${replacement}${source.slice(end + INDEX_END.length)}`

  if (updated !== source) {
    await writeFile(INDEX_PATH, updated, 'utf8')
  }
}

async function syncExperienceSidebar(experiences) {
  const items = experiences.map((experience) => ({
    text: experience.title,
    link: `/experiencias/${experience.slug}`,
  }))
  const source = `export default ${JSON.stringify(items, null, 2)}\n`
  try {
    if (await readFile(EXPERIENCE_SIDEBAR, 'utf8') === source) return
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await writeAtomic(EXPERIENCE_SIDEBAR, Buffer.from(source, 'utf8'))
}

function readProfile(source) {
  const parsed = matter(source)
  const sections = parseSections(parsed.content)
  const headerBlock = parsed.content.split(/^##\s+/m)[0]
  const headerLines = headerBlock.split(/\r?\n/).filter((line) => !/^#\s+/.test(line))
  const headlineParts = (paragraphs(headerLines)[0] ?? '').split(/\s+·\s+/)
  const headline = headlineParts.shift() ?? ''
  const location = headlineParts.join(' · ')
  const email = parsed.content.match(/\]\(mailto:([^\)]+)\)/i)?.[1] ?? ''
  const profile = {
    name: String(parsed.data.title ?? parsed.content.match(/^#\s+(.+)$/m)?.[1] ?? 'CV').trim(),
    headline,
    location,
    email,
    bio: paragraphs(getSection(sections, 'Bio')),
    languages: listItems(getSection(sections, 'Languages')),
    education: listItems(getSection(sections, 'Education and certifications')),
  }

  if (!profile.headline || !profile.bio.length || !profile.languages.length || !profile.education.length || !profile.email) {
    throw new Error('Profile Markdown is missing headline, bio, languages, education, or email.')
  }
  return profile
}

function readSkillGroups(source) {
  const parsed = matter(source)
  const sections = parseSections(parsed.content)
  const groups = [...sections.entries()]
    .filter(([title]) => title !== 'Additional documented capabilities')
    .map(([title, lines]) => ({ title, items: listItems(lines) }))
    .filter((group) => group.items.length)
  const additional = paragraphs(getSection(sections, 'Additional documented capabilities')).slice(0, 1)

  if (!groups.length) throw new Error('Skills Markdown contains no categorized skills.')
  if (additional.length) groups.push({ title: 'Additional documented capabilities', items: additional })
  return groups
}

async function loadCvModel() {
  const [profileSource, skillsSource, experiences] = await Promise.all([
    readFile(join(DOCS, 'index.md'), 'utf8'),
    readFile(join(DOCS, 'skills.md'), 'utf8'),
    loadExperiences(),
  ])

  if (!experiences.length) throw new Error('No experience Markdown pages were found.')
  await syncExperienceIndex(experiences)
  await syncExperienceSidebar(experiences)
  return { profile: readProfile(profileSource), skills: readSkillGroups(skillsSource), experiences }
}

function pdfParagraph(document, text, options = {}) {
  if (!text) return
  const { font = 'Helvetica', size = 9.4, color = '#253532', after = 0.28, ...layout } = options
  const width = document.page.width - document.page.margins.left - document.page.margins.right - (layout.indent ?? 0)
  document.font(font).fontSize(size).fillColor(color)
  const textOptions = { width, lineGap: 2, ...layout }
  const height = document.heightOfString(text, textOptions)
  const pageBottom = document.page.height - document.page.margins.bottom
  const pageHeight = pageBottom - document.page.margins.top
  if (height <= pageHeight && document.y + height > pageBottom) document.addPage()
  document.text(text, textOptions)
  document.moveDown(after)
}

function pdfSectionHeading(document, title) {
  document.moveDown(0.35)
  document.font('Helvetica-Bold').fontSize(11).fillColor('#294f57').text(title.toUpperCase())
  const y = document.y + 3
  document.moveTo(document.page.margins.left, y)
    .lineTo(document.page.width - document.page.margins.right, y)
    .lineWidth(0.55)
    .strokeColor('#78a2ab')
    .stroke()
  document.moveDown(0.48)
}

function renderPdf(document, model) {
  const { profile, skills, experiences } = model
  const width = document.page.width - document.page.margins.left - document.page.margins.right

  document.font('Helvetica').fontSize(27).fillColor('#254b53').text(profile.name.toUpperCase(), { width, characterSpacing: 0.4 })
  document.moveTo(document.page.margins.left, document.y + 5)
    .lineTo(document.page.width - document.page.margins.right, document.y + 5)
    .lineWidth(1.2)
    .strokeColor('#5793a2')
    .stroke()
  document.moveDown(0.6)
  pdfParagraph(document, profile.headline, { font: 'Helvetica', size: 10.5, color: '#253532', after: 0.15 })
  pdfParagraph(document, [profile.email, profile.location].filter(Boolean).join('  ·  '), { size: 8.8, color: '#596963', after: 0.45 })

  pdfSectionHeading(document, 'Profile')
  for (const paragraph of profile.bio) pdfParagraph(document, paragraph)

  pdfSectionHeading(document, 'Technical and functional skills')
  for (const group of skills) {
    document.font('Helvetica-Bold').fontSize(8.7).fillColor('#253532').text(`${group.title}: `, { continued: true, width })
    document.font('Helvetica').fontSize(8.7).fillColor('#253532').text(group.items.join('; '), { width, lineGap: 1.6 })
    document.moveDown(0.22)
  }

  pdfSectionHeading(document, 'Languages')
  pdfParagraph(document, profile.languages.join('  |  '), { size: 9, after: 0.25 })

  pdfSectionHeading(document, 'Education and certifications')
  for (const item of profile.education) pdfParagraph(document, item, { size: 8.9, after: 0.18 })

  pdfSectionHeading(document, 'Professional experience')
  for (const experience of experiences) {
    document.font('Helvetica-Bold').fontSize(9.6).fillColor('#253532').text(`${experience.role} | ${experience.title}`, { width })
    document.font('Helvetica-Oblique').fontSize(8.5).fillColor('#596963').text(`${experience.period} | ${experience.location}`, { width })
    document.moveDown(0.18)
    pdfParagraph(document, experience.projectContext, { size: 8.7, after: 0.12 })
    for (const contribution of experience.contributions) {
      pdfParagraph(document, `• ${contribution}`, { size: 8.5, indent: 8, hanging: 3, after: 0.08 })
    }
    document.font('Helvetica-Bold').fontSize(8.2).fillColor('#253532').text('Technologies and skills: ', { continued: true, width })
    document.font('Helvetica').fontSize(8.2).fillColor('#253532').text(experience.technologies.join(', '), { width, lineGap: 1.4 })
    document.moveDown(0.52)
  }
}

function docxText(text, options = {}) {
  return new TextRun({
    text,
    font: 'Arial',
    size: options.size ?? 19,
    bold: options.bold ?? false,
    italics: options.italics ?? false,
    color: options.color ?? '253532',
  })
}

function docxParagraph(text, options = {}) {
  return new Paragraph({
    children: [docxText(text, options)],
    spacing: { before: options.before ?? 0, after: options.after ?? 90, line: 250 },
    bullet: options.bullet ? { level: 0 } : undefined,
  })
}

function docxSectionHeading(title) {
  return new Paragraph({
    children: [docxText(title.toUpperCase(), { size: 21, bold: true, color: '294F57' })],
    spacing: { before: 230, after: 100 },
    border: { bottom: { color: '78A2AB', space: 4, size: 5, style: BorderStyle.SINGLE } },
  })
}

function renderDocx(model) {
  const { profile, skills, experiences } = model
  const children = [
    docxParagraph(profile.name.toUpperCase(), { size: 34, color: '254B53', after: 40 }),
    new Paragraph({
      children: [docxText('', { size: 1 })],
      border: { bottom: { color: '5793A2', space: 5, size: 10, style: BorderStyle.SINGLE } },
      spacing: { after: 120 },
    }),
    docxParagraph(profile.headline, { size: 21, after: 35 }),
    docxParagraph([profile.email, profile.location].filter(Boolean).join('  |  '), { size: 17, color: '596963', after: 140 }),
    docxSectionHeading('Profile'),
    ...profile.bio.map((paragraph) => docxParagraph(paragraph)),
    docxSectionHeading('Technical and functional skills'),
  ]

  for (const group of skills) {
    children.push(new Paragraph({
      children: [docxText(`${group.title}: `, { bold: true }), docxText(group.items.join('; '))],
      spacing: { after: 75, line: 250 },
    }))
  }

  children.push(docxSectionHeading('Languages'))
  children.push(docxParagraph(profile.languages.join('  |  ')))
  children.push(docxSectionHeading('Education and certifications'))
  for (const item of profile.education) children.push(docxParagraph(item))
  children.push(docxSectionHeading('Professional experience'))

  for (const experience of experiences) {
    children.push(docxParagraph(`${experience.role} | ${experience.title}`, { bold: true, size: 20, before: 100, after: 35 }))
    children.push(docxParagraph(`${experience.period} | ${experience.location}`, { italics: true, size: 17, color: '596963', after: 70 }))
    children.push(docxParagraph(experience.projectContext, { size: 17, after: 50 }))
    for (const contribution of experience.contributions) {
      children.push(docxParagraph(contribution, { size: 17, bullet: true, after: 35 }))
    }
    children.push(new Paragraph({
      children: [docxText('Technologies and skills: ', { bold: true, size: 16 }), docxText(experience.technologies.join(', '), { size: 16 })],
      spacing: { after: 130, line: 240 },
    }))
  }

  const footer = new Footer({
    children: [new Paragraph({ children: [docxText('Leonardo Rivaldo · CV', { size: 15, color: '596963' })] })],
  })
  return new Document({
    sections: [{
      properties: { page: { margin: { top: 720, right: 820, bottom: 720, left: 820 } } },
      footers: { default: footer },
      children,
    }],
  })
}

async function renderPdfBuffer(model) {
  const document = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Leonardo Rivaldo CV', Author: 'Leonardo Rivaldo' } })
  const chunks = []
  const finished = new Promise((resolve, reject) => {
    document.on('data', (chunk) => chunks.push(chunk))
    document.on('end', () => resolve(Buffer.concat(chunks)))
    document.on('error', reject)
  })
  renderPdf(document, model)
  document.end()
  return finished
}

async function writeAtomic(path, buffer) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, buffer)
  await rename(temporary, path)
}

async function withBuildLock(task) {
  let lock
  for (let attempt = 0; attempt < 600 && !lock; attempt += 1) {
    try {
      lock = await open(BUILD_LOCK, 'wx')
      await lock.writeFile(String(process.pid))
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      try {
        const info = await stat(BUILD_LOCK)
        if (Date.now() - info.mtimeMs > 120_000) await unlink(BUILD_LOCK)
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  if (!lock) throw new Error('Timed out waiting for another CV generation to finish.')
  try {
    return await task()
  } finally {
    await lock.close()
    await unlink(BUILD_LOCK).catch(() => {})
  }
}

export async function buildCv() {
  return withBuildLock(async () => {
    const model = await loadCvModel()
    const [docxBuffer, pdfBuffer] = await Promise.all([
      Packer.toBuffer(renderDocx(model)),
      renderPdfBuffer(model),
    ])

    if (docxBuffer.subarray(0, 2).toString() !== 'PK') throw new Error('DOCX output is not a valid ZIP package.')
    if (pdfBuffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF output has an invalid signature.')

    await Promise.all([writeAtomic(CV_DOCX, docxBuffer), writeAtomic(CV_PDF, pdfBuffer)])
    return { docx: CV_DOCX, pdf: CV_PDF, experienceCount: model.experiences.length }
  })
}

async function watchMarkdown() {
  const { watch } = await import('chokidar')
  const watcher = watch([
    join(DOCS, 'index.md'),
    join(DOCS, 'skills.md'),
    join(EXPERIENCES, '*.md'),
  ], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    ignored: (path) => basename(path) === 'index.md' && dirname(path) === EXPERIENCES,
  })

  let timer
  let running = false
  let pending = false

  async function scheduleBuild() {
    if (running) {
      pending = true
      return
    }
    running = true
    do {
      pending = false
      try {
        const result = await buildCv()
        console.log(`CV artifacts updated (${result.experienceCount} experiences).`)
      } catch (error) {
        console.error('CV generation failed:', error)
      }
    } while (pending)
    running = false
  }

  watcher.on('add', () => {
    clearTimeout(timer)
    timer = setTimeout(scheduleBuild, 500)
  })
  watcher.on('change', () => {
    clearTimeout(timer)
    timer = setTimeout(scheduleBuild, 500)
  })
  watcher.on('unlink', () => {
    clearTimeout(timer)
    timer = setTimeout(scheduleBuild, 500)
  })
  watcher.on('ready', () => console.log('Watching public Markdown for CV changes.'))
  await buildCv().then((result) => console.log(`Initial CV generation complete (${result.experienceCount} experiences).`))
}

const command = process.argv[2] ?? 'build'
if (command === 'build') {
  const result = await buildCv()
  console.log(`Generated ${result.docx}`)
  console.log(`Generated ${result.pdf}`)
  console.log(`Included ${result.experienceCount} experiences.`)
} else if (command === 'watch') {
  await watchMarkdown()
} else {
  throw new Error(`Unknown command: ${command}`)
}