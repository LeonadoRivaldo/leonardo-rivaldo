import { execFile } from "node:child_process";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

const DOCS_ROOT = resolve(process.cwd(), "..", "docs");
const PROJECT_ROOT = resolve(process.cwd(), "..", "..");
const MAX_DOCUMENT_SIZE = 500_000;
const execFileAsync = promisify(execFile);
const MONTHS = new Map([
  ["january", 1], ["february", 2], ["march", 3], ["april", 4],
  ["may", 5], ["june", 6], ["july", 7], ["august", 8],
  ["september", 9], ["october", 10], ["november", 11], ["december", 12],
]);

function isPublicMarkdown(filePath: string) {
  const filename = basename(filePath).toLowerCase();
  return filePath.endsWith(".md")
    && filename !== "notas_consolidacao.md"
    && !filename.startsWith("readme - ");
}

async function listPublicDocuments(directory = DOCS_ROOT, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const documents: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(".")) {
      continue;
    }

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      documents.push(...await listPublicDocuments(resolve(directory, entry.name), relativePath));
    } else if (entry.isFile() && isPublicMarkdown(relativePath)) {
      documents.push(relativePath);
    }
  }

  return documents.sort((left, right) => left.localeCompare(right));
}

function resolveDocumentPath(documentPath: string) {
  if (!documentPath || documentPath.includes("\\") || isAbsolute(documentPath)) {
    return null;
  }

  const segments = documentPath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  const absolutePath = resolve(DOCS_ROOT, documentPath);
  const relativePath = relative(DOCS_ROOT, absolutePath);
  if (relativePath.startsWith(`..${sep}`) || relativePath === ".." || isAbsolute(relativePath)) {
    return null;
  }

  return absolutePath;
}

async function getDocumentSummaries() {
  const paths = await listPublicDocuments();

  const documents = await Promise.all(paths.map(async (path) => {
    const content = await readFile(resolveDocumentPath(path)!, "utf8");
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(path, ".md");
    return { path, title, sortKey: path.startsWith("experiencias/") && path !== "experiencias/index.md"
      ? getExperienceSortKey(content)
      : Number.MAX_SAFE_INTEGER };
  }));

  return documents
    .sort((left, right) => {
      if (left.path === "experiencias/index.md") return -1;
      if (right.path === "experiencias/index.md") return 1;
      if (left.sortKey !== right.sortKey) return left.sortKey - right.sortKey;
      return left.title.localeCompare(right.title);
    })
    .map(({ path, title }) => ({ path, title }));
}

function getExperienceSortKey(content: string) {
  const period = content.match(/^\*\*Period:\*\*\s*(.+)$/mi)?.[1]?.trim() ?? "";
  const start = period.match(/^(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+)?(\d{4})\b/i);
  if (!start) return Number.MAX_SAFE_INTEGER;

  const month = start[1] ? MONTHS.get(start[1].toLowerCase()) ?? 1 : 1;
  return Number(start[2]) * 12 + month;
}

function oneLine(value: unknown) {
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim() : "";
}

function multiline(value: unknown) {
  return typeof value === "string"
    ? value.split(/\r?\n/).map((line) => line.replace(/^\s*[-*+]\s*/, "").trim()).filter(Boolean)
    : [];
}

function experienceSlug(title: string) {
  return title
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildExperienceMarkdown(data: {
  title: string;
  role: string;
  period: string;
  location: string;
  projectContext: string;
  contributions: string[];
  technologies: string[];
}) {
  const title = JSON.stringify(data.title);
  const contributions = data.contributions.map((item) => `- ${item}`).join("\n");
  const technologies = data.technologies.map((item) => `- ${item}`).join("\n");

  return `---\ntitle: ${title}\n---\n\n# ${data.title}\n\n**Role:** ${data.role}  \n**Period:** ${data.period}  \n**Location:** ${data.location}\n\n## Project context\n\n${data.projectContext}\n\n## My contribution\n\n${contributions}\n\n## Technologies and skills\n\nThese technologies and skills are listed in my experience record or described in the project context. They do not imply equal proficiency or sole responsibility for every component.\n\n${technologies}\n\n---\n\n[All experiences](/experiencias/) · [Skills](/skills) · [Home](/)\n`;
}

async function buildCvArtifacts() {
  await execFileAsync(process.execPath, ["scripts/cv.mjs", "build"], {
    cwd: PROJECT_ROOT,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
}

export async function GET(request: NextRequest) {
  try {
    const documentPath = request.nextUrl.searchParams.get("path");

    if (!documentPath) {
      return NextResponse.json({ documents: await getDocumentSummaries() }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const publicDocuments = await listPublicDocuments();
    if (!publicDocuments.includes(documentPath)) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    const absolutePath = resolveDocumentPath(documentPath);
    if (!absolutePath) {
      return NextResponse.json({ error: "Invalid document path." }, { status: 400 });
    }

    const content = await readFile(absolutePath, "utf8");
    return NextResponse.json({ path: documentPath, content }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Unable to read the content directory." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as { path?: unknown; content?: unknown };
    if (typeof body.path !== "string" || typeof body.content !== "string") {
      return NextResponse.json({ error: "A document path and Markdown content are required." }, { status: 400 });
    }

    if (Buffer.byteLength(body.content, "utf8") > MAX_DOCUMENT_SIZE) {
      return NextResponse.json({ error: "The document exceeds the 500 KB limit." }, { status: 413 });
    }

    const publicDocuments = await listPublicDocuments();
    if (!publicDocuments.includes(body.path)) {
      return NextResponse.json({ error: "Only existing public Markdown pages can be edited." }, { status: 404 });
    }

    const absolutePath = resolveDocumentPath(body.path);
    if (!absolutePath) {
      return NextResponse.json({ error: "Invalid document path." }, { status: 400 });
    }

    const previousContent = await readFile(absolutePath, "utf8");
    await writeFile(absolutePath, body.content, "utf8");
    try {
      await buildCvArtifacts();
    } catch (buildError) {
      await writeFile(absolutePath, previousContent, "utf8");
      await buildCvArtifacts().catch(() => undefined);
      throw buildError;
    }
    return NextResponse.json({ saved: true });
  } catch {
    return NextResponse.json({ error: "Unable to save this document." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const title = oneLine(body.title);
    const role = oneLine(body.role);
    const period = oneLine(body.period);
    const location = oneLine(body.location);
    const projectContext = oneLine(body.projectContext);
    const contributions = multiline(body.contributions);
    const technologies = multiline(body.technologies);

    if (!title || !role || !period || !location || !projectContext || !contributions.length || !technologies.length) {
      return NextResponse.json({ error: "Complete every field and add at least one contribution and technology." }, { status: 400 });
    }
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_DOCUMENT_SIZE) {
      return NextResponse.json({ error: "The experience exceeds the 500 KB limit." }, { status: 413 });
    }
    if (getExperienceSortKey(`**Period:** ${period}`) === Number.MAX_SAFE_INTEGER) {
      return NextResponse.json({ error: "Use a period like August 2024–March 2026 or 2026–Present." }, { status: 400 });
    }

    const slug = experienceSlug(title);
    if (!slug) {
      return NextResponse.json({ error: "The title cannot be used to create a Markdown filename." }, { status: 400 });
    }

    const documentPath = `experiencias/${slug}.md`;
    const absolutePath = resolveDocumentPath(documentPath);
    if (!absolutePath || (await listPublicDocuments()).includes(documentPath)) {
      return NextResponse.json({ error: "An experience with this title already exists." }, { status: 409 });
    }

    const content = buildExperienceMarkdown({ title, role, period, location, projectContext, contributions, technologies });
    await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
    try {
      await buildCvArtifacts();
    } catch (buildError) {
      await unlink(absolutePath).catch(() => undefined);
      await buildCvArtifacts().catch(() => undefined);
      throw buildError;
    }

    return NextResponse.json({ path: documentPath, title }, { status: 201 });
  } catch (error) {
    console.error("Unable to create experience:", error);
    return NextResponse.json({ error: "Unable to create experience and regenerate the CV." }, { status: 500 });
  }
}