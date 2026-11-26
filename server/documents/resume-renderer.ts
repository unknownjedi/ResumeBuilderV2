import fs from "node:fs";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import {
  ResumeTemplateSettingsSchema,
  type CoverLetterContent,
  type MarginPreset,
  type PaperSize,
  type ResumeSection,
  type ResumeTemplateSettings,
  type StructuredResumeDocument,
} from "../ai/schemas/resume-generation";
import { resolveAppDataDir } from "../files/paths";

export class PdfBrowserMissingError extends Error {
  readonly code = "PDF_BROWSER_MISSING";
  readonly status = 422;
  readonly installCommand: string;

  constructor(message: string, installCommand: string) {
    super(message);
    this.name = "PdfBrowserMissingError";
    this.installCommand = installCommand;
  }
}

export interface ResumeRenderOptions {
  title?: string;
  fontFamily?: "sans" | "serif";
  accentColor?: string;
}

export interface CoverLetterRenderMeta {
  senderName?: string | null;
  senderEmail?: string | null;
  senderPhone?: string | null;
  senderLocation?: string | null;
  dateText?: string | null;
  companyName?: string | null;
  roleTitle?: string | null;
}

const SAFE_HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function resolveAccentColor(color?: string): string {
  if (color && SAFE_HEX_COLOR_RE.test(color.trim())) {
    return color.trim();
  }
  return "#1f2937";
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeSafeHref(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:"
    ) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function resolveTemplateSettings(
  settings?: Partial<ResumeTemplateSettings>
): ResumeTemplateSettings {
  return ResumeTemplateSettingsSchema.parse(settings ?? {});
}

function isSectionVisible(
  section: ResumeSection,
  settings: ResumeTemplateSettings
): boolean {
  switch (section.type) {
    case "summary":
      return settings.showSummary && Boolean(section.summaryText?.trim());
    case "projects":
      return settings.showProjects && section.entries.length > 0;
    case "achievements":
      return settings.showAchievements && section.entries.length > 0;
    case "certifications":
      return settings.showCertifications && section.entries.length > 0;
    case "languages":
      return settings.showLanguages && section.entries.length > 0;
    case "skills":
      return section.skillGroups.some((g) => g.items.length > 0);
    case "experience":
    case "education":
      return section.entries.length > 0;
  }
}

function getVisibleSections(
  doc: StructuredResumeDocument,
  settings: ResumeTemplateSettings
): ResumeSection[] {
  return [...doc.sections]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((section) => isSectionVisible(section, settings));
}

function getCssPageMargin(
  preset: MarginPreset,
  paperSize: PaperSize
): string {
  if (paperSize === "Letter") {
    switch (preset) {
      case "compact":
        return "0.5in 0.55in";
      case "relaxed":
        return "0.9in 0.95in";
      case "standard":
      default:
        return "0.7in 0.75in";
    }
  }
  switch (preset) {
    case "compact":
      return "12mm 14mm";
    case "relaxed":
      return "22mm 22mm";
    case "standard":
    default:
      return "16mm 18mm";
  }
}

function getDocxMarginTwips(preset: MarginPreset): number {
  switch (preset) {
    case "compact":
      return 720; // 0.5 inch
    case "relaxed":
      return 1440; // 1.0 inch
    case "standard":
    default:
      return 1080; // 0.75 inch
  }
}

function getDocxPageSizeTwips(paperSize: PaperSize): {
  width: number;
  height: number;
} {
  if (paperSize === "Letter") {
    return { width: 12240, height: 15840 };
  }
  return { width: 11906, height: 16838 };
}

function getFontStack(fontFamily: "sans" | "serif" = "sans"): string {
  if (fontFamily === "serif") {
    return 'Georgia, "Times New Roman", Times, serif';
  }
  return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
}

/**
 * Renders a crisp, single-column, ATS-safe HTML resume document with full HTML escaping.
 */
export function renderResumeHtml(
  doc: StructuredResumeDocument,
  rawSettings?: Partial<ResumeTemplateSettings>,
  options?: ResumeRenderOptions
): string {
  const settings = resolveTemplateSettings(rawSettings);
  const accentColor = resolveAccentColor(options?.accentColor);
  const fontStack = getFontStack(options?.fontFamily ?? "sans");
  const pageMargin = getCssPageMargin(settings.marginPreset, settings.paperSize);
  const baseFontPt = Number((10.5 * settings.fontSizeScale).toFixed(2));
  const lineHeight = Number((1.38 * settings.lineHeightScale).toFixed(2));
  const docTitle = escapeHtml(
    options?.title?.trim() || `${doc.header.fullName} - Resume`
  );

  const contactItems: string[] = [];
  if (doc.header.location?.trim()) {
    contactItems.push(`<span>${escapeHtml(doc.header.location.trim())}</span>`);
  }
  if (doc.header.email?.trim()) {
    const email = doc.header.email.trim();
    const mailHref = sanitizeSafeHref(`mailto:${email}`);
    contactItems.push(
      mailHref
        ? `<a href="${escapeHtml(mailHref)}">${escapeHtml(email)}</a>`
        : `<span>${escapeHtml(email)}</span>`
    );
  }
  if (doc.header.phone?.trim()) {
    contactItems.push(`<span>${escapeHtml(doc.header.phone.trim())}</span>`);
  }
  for (const link of doc.header.links) {
    const safeHref = sanitizeSafeHref(link.url);
    if (safeHref) {
      contactItems.push(
        `<a href="${escapeHtml(safeHref)}">${escapeHtml(link.label)}</a>`
      );
    } else {
      contactItems.push(
        `<span>${escapeHtml(link.label)}: ${escapeHtml(link.url)}</span>`
      );
    }
  }

  const visibleSections = getVisibleSections(doc, settings);

  const sectionsHtml = visibleSections
    .map((section) => {
      const headingHtml = `<h2 class="section-title">${escapeHtml(section.title)}</h2>`;

      if (section.type === "summary" && section.summaryText?.trim()) {
        return `<section class="resume-section" data-section-type="summary">
  ${headingHtml}
  <p class="summary-text">${escapeHtml(section.summaryText.trim())}</p>
</section>`;
      }

      if (section.type === "skills") {
        const groupsHtml = section.skillGroups
          .filter((g) => g.items.length > 0)
          .map((group) => {
            const itemsText = group.items
              .map((item) =>
                item.proficiency
                  ? `${item.name} (${item.proficiency})`
                  : item.name
              )
              .join(", ");
            return `<p class="skill-group"><span class="skill-group-label">${escapeHtml(group.label)}:</span> ${escapeHtml(itemsText)}</p>`;
          })
          .join("\n  ");

        return `<section class="resume-section" data-section-type="skills">
  ${headingHtml}
  ${groupsHtml}
</section>`;
      }

      const entriesHtml = [...section.entries]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((entry) => {
          const metaRightParts = [entry.dateRange, entry.location]
            .map((v) => v?.trim())
            .filter((v): v is string => Boolean(v));
          const metaRight = metaRightParts.join(" · ");

          const bulletsSorted = [...entry.bullets].sort(
            (a, b) => a.sortOrder - b.sortOrder
          );
          const bulletsHtml =
            bulletsSorted.length > 0
              ? `<ul class="entry-bullets">
    ${bulletsSorted
      .map((b) => `<li>${escapeHtml(b.text)}</li>`)
      .join("\n    ")}
  </ul>`
              : "";

          return `<article class="resume-entry">
  <div class="entry-header">
    <div class="entry-titles">
      <h3 class="entry-heading">${escapeHtml(entry.heading)}</h3>${
        entry.subheading?.trim()
          ? ` <span class="entry-subheading">— ${escapeHtml(entry.subheading.trim())}</span>`
          : ""
      }
    </div>${
      metaRight
        ? `\n    <div class="entry-meta">${escapeHtml(metaRight)}</div>`
        : ""
    }
  </div>
  ${bulletsHtml}
</article>`;
        })
        .join("\n  ");

      return `<section class="resume-section" data-section-type="${escapeHtml(section.type)}">
  ${headingHtml}
  ${entriesHtml}
</section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${docTitle}</title>
<style>
  @page {
    size: ${settings.paperSize};
    margin: ${pageMargin};
  }
  * {
    box-sizing: border-box;
  }
  html, body {
    margin: 0;
    padding: 0;
    color: #111827;
    background: #ffffff;
    font-family: ${fontStack};
    font-size: ${baseFontPt}pt;
    line-height: ${lineHeight};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .resume-document {
    width: 100%;
    max-width: 100%;
  }
  .resume-header {
    margin-bottom: 12pt;
    padding-bottom: 8pt;
    border-bottom: 1.25pt solid ${accentColor};
  }
  .candidate-name {
    margin: 0;
    font-size: 1.85em;
    font-weight: 700;
    letter-spacing: -0.015em;
    color: #0f172a;
    line-height: 1.15;
  }
  .candidate-headline {
    margin: 3pt 0 0 0;
    font-size: 1.05em;
    font-weight: 500;
    color: #374151;
  }
  .contact-line {
    margin: 5pt 0 0 0;
    font-size: 0.9em;
    color: #4b5563;
    display: flex;
    flex-wrap: wrap;
    gap: 4pt 10pt;
  }
  .contact-line a {
    color: inherit;
    text-decoration: none;
  }
  .resume-section {
    margin-top: 10pt;
  }
  .section-title {
    margin: 0 0 5pt 0;
    padding-bottom: 2pt;
    font-size: 0.95em;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: ${accentColor};
    border-bottom: 0.75pt solid #d1d5db;
    break-after: avoid;
    page-break-after: avoid;
  }
  .summary-text {
    margin: 0;
    color: #1f2937;
  }
  .skill-group {
    margin: 2pt 0;
    color: #1f2937;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .skill-group-label {
    font-weight: 600;
    color: #111827;
  }
  .resume-entry {
    margin-top: 6pt;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .entry-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8pt;
    flex-wrap: wrap;
  }
  .entry-titles {
    font-size: 1em;
  }
  .entry-heading {
    display: inline;
    margin: 0;
    font-size: 1em;
    font-weight: 700;
    color: #111827;
  }
  .entry-subheading {
    font-weight: 500;
    color: #374151;
  }
  .entry-meta {
    font-size: 0.88em;
    color: #4b5563;
    white-space: nowrap;
  }
  .entry-bullets {
    margin: 3pt 0 0 0;
    padding-left: 14pt;
  }
  .entry-bullets li {
    margin: 1.5pt 0;
    color: #1f2937;
    break-inside: avoid;
    page-break-inside: avoid;
  }
</style>
</head>
<body>
<main class="resume-document">
  <header class="resume-header">
    <h1 class="candidate-name">${escapeHtml(doc.header.fullName)}</h1>${
      doc.header.headline?.trim()
        ? `\n    <p class="candidate-headline">${escapeHtml(doc.header.headline.trim())}</p>`
        : ""
    }${
      contactItems.length > 0
        ? `\n    <div class="contact-line">${contactItems.join(" ")}</div>`
        : ""
    }
  </header>
  ${sectionsHtml}
</main>
</body>
</html>`;
}

/**
 * Renders a structured resume as clean ATS-friendly plain text.
 */
export function renderResumePlainText(
  doc: StructuredResumeDocument,
  rawSettings?: Partial<ResumeTemplateSettings>
): string {
  const settings = resolveTemplateSettings(rawSettings);
  const lines: string[] = [];

  lines.push(doc.header.fullName);
  if (doc.header.headline?.trim()) {
    lines.push(doc.header.headline.trim());
  }

  const contactParts = [
    doc.header.location?.trim(),
    doc.header.email?.trim(),
    doc.header.phone?.trim(),
    ...doc.header.links.map((l) => `${l.label}: ${l.url}`),
  ].filter((v): v is string => Boolean(v));

  if (contactParts.length > 0) {
    lines.push(contactParts.join(" | "));
  }

  for (const section of getVisibleSections(doc, settings)) {
    lines.push("");
    lines.push(section.title.toUpperCase());
    lines.push("-".repeat(Math.max(12, section.title.length)));

    if (section.type === "summary" && section.summaryText?.trim()) {
      lines.push(section.summaryText.trim());
      continue;
    }

    if (section.type === "skills") {
      for (const group of section.skillGroups) {
        if (group.items.length === 0) continue;
        const skillNames = group.items
          .map((i) => (i.proficiency ? `${i.name} (${i.proficiency})` : i.name))
          .join(", ");
        lines.push(`${group.label}: ${skillNames}`);
      }
      continue;
    }

    for (const entry of [...section.entries].sort(
      (a, b) => a.sortOrder - b.sortOrder
    )) {
      const titleLine = [entry.heading, entry.subheading]
        .map((v) => v?.trim())
        .filter((v): v is string => Boolean(v))
        .join(" — ");
      const metaLine = [entry.dateRange, entry.location]
        .map((v) => v?.trim())
        .filter((v): v is string => Boolean(v))
        .join(" | ");
      lines.push(metaLine ? `${titleLine} (${metaLine})` : titleLine);

      for (const bullet of [...entry.bullets].sort(
        (a, b) => a.sortOrder - b.sortOrder
      )) {
        lines.push(`  * ${bullet.text}`);
      }
    }
  }

  return lines.join("\n").trim() + "\n";
}

/**
 * Renders a structured resume as clean Markdown.
 */
export function renderResumeMarkdown(
  doc: StructuredResumeDocument,
  rawSettings?: Partial<ResumeTemplateSettings>
): string {
  const settings = resolveTemplateSettings(rawSettings);
  const lines: string[] = [];

  lines.push(`# ${doc.header.fullName}`);
  if (doc.header.headline?.trim()) {
    lines.push(`**${doc.header.headline.trim()}**`);
  }

  const contactParts = [
    doc.header.location?.trim(),
    doc.header.email?.trim(),
    doc.header.phone?.trim(),
    ...doc.header.links.map((l) => `[${l.label}](${l.url})`),
  ].filter((v): v is string => Boolean(v));

  if (contactParts.length > 0) {
    lines.push(contactParts.join(" · "));
  }

  for (const section of getVisibleSections(doc, settings)) {
    lines.push("");
    lines.push(`## ${section.title}`);

    if (section.type === "summary" && section.summaryText?.trim()) {
      lines.push("");
      lines.push(section.summaryText.trim());
      continue;
    }

    if (section.type === "skills") {
      lines.push("");
      for (const group of section.skillGroups) {
        if (group.items.length === 0) continue;
        const skillNames = group.items
          .map((i) => (i.proficiency ? `${i.name} (${i.proficiency})` : i.name))
          .join(", ");
        lines.push(`- **${group.label}:** ${skillNames}`);
      }
      continue;
    }

    for (const entry of [...section.entries].sort(
      (a, b) => a.sortOrder - b.sortOrder
    )) {
      lines.push("");
      const titlePart = entry.subheading?.trim()
        ? `### ${entry.heading} — ${entry.subheading.trim()}`
        : `### ${entry.heading}`;
      lines.push(titlePart);

      const metaPart = [entry.dateRange, entry.location]
        .map((v) => v?.trim())
        .filter((v): v is string => Boolean(v))
        .join(" · ");
      if (metaPart) {
        lines.push(`*${metaPart}*`);
      }

      for (const bullet of [...entry.bullets].sort(
        (a, b) => a.sortOrder - b.sortOrder
      )) {
        lines.push(`- ${bullet.text}`);
      }
    }
  }

  return lines.join("\n").trim() + "\n";
}

/**
 * Generates an ATS-safe single-column DOCX buffer from a StructuredResumeDocument.
 */
export async function exportResumeToDocxBuffer(
  doc: StructuredResumeDocument,
  rawSettings?: Partial<ResumeTemplateSettings>
): Promise<Buffer> {
  const settings = resolveTemplateSettings(rawSettings);
  const margin = getDocxMarginTwips(settings.marginPreset);
  const pageSize = getDocxPageSizeTwips(settings.paperSize);

  const scalePt = (basePt: number) =>
    Math.round(basePt * settings.fontSizeScale * 2); // half-points
  const lineSpacing = Math.round(240 * settings.lineHeightScale);

  const children: Paragraph[] = [];

  // Header: Name
  children.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: doc.header.fullName,
          bold: true,
          size: scalePt(18),
          color: "0F172A",
        }),
      ],
    })
  );

  // Header: Headline
  if (doc.header.headline?.trim()) {
    children.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({
            text: doc.header.headline.trim(),
            size: scalePt(11),
            color: "374151",
          }),
        ],
      })
    );
  }

  // Header: Contact line
  const contactRuns: Array<TextRun | ExternalHyperlink> = [];
  const pushSeparator = () => {
    if (contactRuns.length > 0) {
      contactRuns.push(
        new TextRun({
          text: "  |  ",
          size: scalePt(9.5),
          color: "6B7280",
        })
      );
    }
  };

  if (doc.header.location?.trim()) {
    pushSeparator();
    contactRuns.push(
      new TextRun({
        text: doc.header.location.trim(),
        size: scalePt(9.5),
        color: "4B5563",
      })
    );
  }
  if (doc.header.email?.trim()) {
    pushSeparator();
    contactRuns.push(
      new TextRun({
        text: doc.header.email.trim(),
        size: scalePt(9.5),
        color: "4B5563",
      })
    );
  }
  if (doc.header.phone?.trim()) {
    pushSeparator();
    contactRuns.push(
      new TextRun({
        text: doc.header.phone.trim(),
        size: scalePt(9.5),
        color: "4B5563",
      })
    );
  }
  for (const link of doc.header.links) {
    pushSeparator();
    const safeHref = sanitizeSafeHref(link.url);
    if (safeHref) {
      contactRuns.push(
        new ExternalHyperlink({
          link: safeHref,
          children: [
            new TextRun({
              text: link.label,
              size: scalePt(9.5),
              color: "1F2937",
              underline: {},
            }),
          ],
        })
      );
    } else {
      contactRuns.push(
        new TextRun({
          text: `${link.label}: ${link.url}`,
          size: scalePt(9.5),
          color: "4B5563",
        })
      );
    }
  }

  children.push(
    new Paragraph({
      spacing: { after: 140 },
      border: {
        bottom: {
          style: BorderStyle.SINGLE,
          size: 8,
          color: "1F2937",
          space: 6,
        },
      },
      children: contactRuns,
    })
  );

  // Sections
  for (const section of getVisibleSections(doc, settings)) {
    children.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 180, after: 80 },
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 4,
            color: "D1D5DB",
            space: 3,
          },
        },
        children: [
          new TextRun({
            text: section.title.toUpperCase(),
            bold: true,
            size: scalePt(10),
            color: "1F2937",
          }),
        ],
      })
    );

    if (section.type === "summary" && section.summaryText?.trim()) {
      children.push(
        new Paragraph({
          spacing: { after: 80, line: lineSpacing },
          children: [
            new TextRun({
              text: section.summaryText.trim(),
              size: scalePt(10.5),
              color: "1F2937",
            }),
          ],
        })
      );
      continue;
    }

    if (section.type === "skills") {
      for (const group of section.skillGroups) {
        if (group.items.length === 0) continue;
        const skillNames = group.items
          .map((i) => (i.proficiency ? `${i.name} (${i.proficiency})` : i.name))
          .join(", ");
        children.push(
          new Paragraph({
            spacing: { after: 50, line: lineSpacing },
            children: [
              new TextRun({
                text: `${group.label}: `,
                bold: true,
                size: scalePt(10.5),
                color: "111827",
              }),
              new TextRun({
                text: skillNames,
                size: scalePt(10.5),
                color: "1F2937",
              }),
            ],
          })
        );
      }
      continue;
    }

    for (const entry of [...section.entries].sort(
      (a, b) => a.sortOrder - b.sortOrder
    )) {
      const headingRuns: TextRun[] = [
        new TextRun({
          text: entry.heading,
          bold: true,
          size: scalePt(10.5),
          color: "111827",
        }),
      ];

      if (entry.subheading?.trim()) {
        headingRuns.push(
          new TextRun({
            text: ` — ${entry.subheading.trim()}`,
            size: scalePt(10.5),
            color: "374151",
          })
        );
      }

      const metaRight = [entry.dateRange, entry.location]
        .map((v) => v?.trim())
        .filter((v): v is string => Boolean(v))
        .join(" · ");
      if (metaRight) {
        headingRuns.push(
          new TextRun({
            text: `   (${metaRight})`,
            size: scalePt(9.5),
            color: "4B5563",
          })
        );
      }

      children.push(
        new Paragraph({
          keepNext: entry.bullets.length > 0,
          spacing: { before: 100, after: 40, line: lineSpacing },
          children: headingRuns,
        })
      );

      for (const bullet of [...entry.bullets].sort(
        (a, b) => a.sortOrder - b.sortOrder
      )) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 40, line: lineSpacing },
            children: [
              new TextRun({
                text: bullet.text,
                size: scalePt(10.5),
                color: "1F2937",
              }),
            ],
          })
        );
      }
    }
  }

  const docxDoc = new Document({
    creator: "Personal Job Copilot",
    title: `${doc.header.fullName} Resume`,
    sections: [
      {
        properties: {
          page: {
            size: {
              width: pageSize.width,
              height: pageSize.height,
            },
            margin: {
              top: margin,
              right: margin,
              bottom: margin,
              left: margin,
            },
          },
        },
        children,
      },
    ],
  });

  const raw = await Packer.toBuffer(docxDoc);
  return Buffer.from(raw);
}

/**
 * Renders a cover letter as clean single-column HTML with full HTML escaping.
 */
export function renderCoverLetterHtml(
  content: CoverLetterContent,
  meta?: CoverLetterRenderMeta,
  rawSettings?: Partial<ResumeTemplateSettings>,
  options?: ResumeRenderOptions
): string {
  const settings = resolveTemplateSettings(rawSettings);
  const accentColor = resolveAccentColor(options?.accentColor);
  const fontStack = getFontStack(options?.fontFamily ?? "sans");
  const pageMargin = getCssPageMargin(settings.marginPreset, settings.paperSize);
  const baseFontPt = Number((10.5 * settings.fontSizeScale).toFixed(2));
  const lineHeight = Number((1.45 * settings.lineHeightScale).toFixed(2));

  const senderName = meta?.senderName?.trim() || content.signature;
  const contactParts = [
    meta?.senderLocation?.trim(),
    meta?.senderEmail?.trim(),
    meta?.senderPhone?.trim(),
  ].filter((v): v is string => Boolean(v));

  const headerHtml = `<header class="letter-header">
    <h1 class="sender-name">${escapeHtml(senderName)}</h1>${
      contactParts.length > 0
        ? `\n    <p class="sender-contact">${contactParts.map(escapeHtml).join(" · ")}</p>`
        : ""
    }
  </header>`;

  const metaLines: string[] = [];
  if (meta?.dateText?.trim()) {
    metaLines.push(`<p class="letter-date">${escapeHtml(meta.dateText.trim())}</p>`);
  }
  if (meta?.companyName?.trim() || meta?.roleTitle?.trim()) {
    const targetText = [meta?.roleTitle?.trim(), meta?.companyName?.trim()]
      .filter(Boolean)
      .join(" — ");
    metaLines.push(`<p class="letter-target">${escapeHtml(targetText)}</p>`);
  }

  const bodyHtml = content.paragraphs
    .map((p) => `<p class="letter-paragraph">${escapeHtml(p.text)}</p>`)
    .join("\n  ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(senderName)} - Cover Letter</title>
<style>
  @page {
    size: ${settings.paperSize};
    margin: ${pageMargin};
  }
  * {
    box-sizing: border-box;
  }
  html, body {
    margin: 0;
    padding: 0;
    color: #111827;
    background: #ffffff;
    font-family: ${fontStack};
    font-size: ${baseFontPt}pt;
    line-height: ${lineHeight};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .letter-header {
    margin-bottom: 16pt;
    padding-bottom: 8pt;
    border-bottom: 1.25pt solid ${accentColor};
  }
  .sender-name {
    margin: 0;
    font-size: 1.65em;
    font-weight: 700;
    color: #0f172a;
  }
  .sender-contact {
    margin: 4pt 0 0 0;
    font-size: 0.9em;
    color: #4b5563;
  }
  .letter-date, .letter-target {
    margin: 0 0 8pt 0;
    color: #374151;
  }
  .letter-greeting {
    margin: 14pt 0 10pt 0;
    font-weight: 600;
  }
  .letter-paragraph {
    margin: 0 0 10pt 0;
    color: #1f2937;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .letter-closing {
    margin: 14pt 0 4pt 0;
  }
  .letter-signature {
    margin: 0;
    font-weight: 600;
    color: #111827;
  }
</style>
</head>
<body>
<main class="cover-letter-document">
  ${headerHtml}
  ${metaLines.join("\n  ")}
  <p class="letter-greeting">${escapeHtml(content.greeting)}</p>
  ${bodyHtml}
  <p class="letter-closing">${escapeHtml(content.closing)}</p>
  <p class="letter-signature">${escapeHtml(content.signature)}</p>
</main>
</body>
</html>`;
}

/**
 * Renders a cover letter as clean plain text.
 */
export function renderCoverLetterPlainText(
  content: CoverLetterContent,
  meta?: CoverLetterRenderMeta
): string {
  const lines: string[] = [];
  if (meta?.senderName?.trim()) {
    lines.push(meta.senderName.trim());
  }
  const contact = [
    meta?.senderLocation?.trim(),
    meta?.senderEmail?.trim(),
    meta?.senderPhone?.trim(),
  ].filter((v): v is string => Boolean(v));
  if (contact.length > 0) {
    lines.push(contact.join(" | "));
  }
  if (lines.length > 0) lines.push("");

  if (meta?.dateText?.trim()) {
    lines.push(meta.dateText.trim());
    lines.push("");
  }
  if (meta?.companyName?.trim() || meta?.roleTitle?.trim()) {
    lines.push(
      [meta?.roleTitle?.trim(), meta?.companyName?.trim()]
        .filter(Boolean)
        .join(" — ")
    );
    lines.push("");
  }

  lines.push(content.greeting);
  lines.push("");
  for (const para of content.paragraphs) {
    lines.push(para.text);
    lines.push("");
  }
  lines.push(content.closing);
  lines.push(content.signature);

  return lines.join("\n").trim() + "\n";
}

/**
 * Renders a cover letter as clean Markdown.
 */
export function renderCoverLetterMarkdown(
  content: CoverLetterContent,
  meta?: CoverLetterRenderMeta
): string {
  const lines: string[] = [];
  const sender = meta?.senderName?.trim() || content.signature;
  lines.push(`# ${sender}`);

  const contact = [
    meta?.senderLocation?.trim(),
    meta?.senderEmail?.trim(),
    meta?.senderPhone?.trim(),
  ].filter((v): v is string => Boolean(v));
  if (contact.length > 0) {
    lines.push(contact.join(" · "));
  }
  lines.push("");

  if (meta?.dateText?.trim()) {
    lines.push(`*${meta.dateText.trim()}*`);
    lines.push("");
  }
  if (meta?.companyName?.trim() || meta?.roleTitle?.trim()) {
    lines.push(
      `**${[meta?.roleTitle?.trim(), meta?.companyName?.trim()]
        .filter(Boolean)
        .join(" — ")}**`
    );
    lines.push("");
  }

  lines.push(content.greeting);
  lines.push("");
  for (const para of content.paragraphs) {
    lines.push(para.text);
    lines.push("");
  }
  lines.push(content.closing);
  lines.push(`**${content.signature}**`);

  return lines.join("\n").trim() + "\n";
}

/**
 * Generates a clean single-column DOCX buffer for a cover letter.
 */
export async function exportCoverLetterToDocxBuffer(
  content: CoverLetterContent,
  meta?: CoverLetterRenderMeta,
  rawSettings?: Partial<ResumeTemplateSettings>
): Promise<Buffer> {
  const settings = resolveTemplateSettings(rawSettings);
  const margin = getDocxMarginTwips(settings.marginPreset);
  const pageSize = getDocxPageSizeTwips(settings.paperSize);
  const scalePt = (basePt: number) =>
    Math.round(basePt * settings.fontSizeScale * 2);
  const lineSpacing = Math.round(240 * settings.lineHeightScale);

  const children: Paragraph[] = [];
  const senderName = meta?.senderName?.trim() || content.signature;

  children.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: senderName,
          bold: true,
          size: scalePt(16),
          color: "0F172A",
        }),
      ],
    })
  );

  const contact = [
    meta?.senderLocation?.trim(),
    meta?.senderEmail?.trim(),
    meta?.senderPhone?.trim(),
  ].filter((v): v is string => Boolean(v));

  if (contact.length > 0) {
    children.push(
      new Paragraph({
        spacing: { after: 160 },
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 6,
            color: "1F2937",
            space: 6,
          },
        },
        children: [
          new TextRun({
            text: contact.join("  |  "),
            size: scalePt(9.5),
            color: "4B5563",
          }),
        ],
      })
    );
  }

  if (meta?.dateText?.trim()) {
    children.push(
      new Paragraph({
        spacing: { before: 120, after: 80 },
        children: [
          new TextRun({
            text: meta.dateText.trim(),
            size: scalePt(10.5),
            color: "374151",
          }),
        ],
      })
    );
  }

  if (meta?.companyName?.trim() || meta?.roleTitle?.trim()) {
    const target = [meta?.roleTitle?.trim(), meta?.companyName?.trim()]
      .filter(Boolean)
      .join(" — ");
    children.push(
      new Paragraph({
        spacing: { after: 140 },
        children: [
          new TextRun({
            text: target,
            bold: true,
            size: scalePt(10.5),
            color: "1F2937",
          }),
        ],
      })
    );
  }

  children.push(
    new Paragraph({
      spacing: { before: 120, after: 140, line: lineSpacing },
      children: [
        new TextRun({
          text: content.greeting,
          bold: true,
          size: scalePt(10.5),
          color: "111827",
        }),
      ],
    })
  );

  for (const para of content.paragraphs) {
    children.push(
      new Paragraph({
        spacing: { after: 140, line: lineSpacing },
        children: [
          new TextRun({
            text: para.text,
            size: scalePt(10.5),
            color: "1F2937",
          }),
        ],
      })
    );
  }

  children.push(
    new Paragraph({
      spacing: { before: 120, after: 60, line: lineSpacing },
      children: [
        new TextRun({
          text: content.closing,
          size: scalePt(10.5),
          color: "1F2937",
        }),
      ],
    })
  );

  children.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: content.signature,
          bold: true,
          size: scalePt(10.5),
          color: "111827",
        }),
      ],
    })
  );

  const docxDoc = new Document({
    creator: "Personal Job Copilot",
    title: `${senderName} Cover Letter`,
    sections: [
      {
        properties: {
          page: {
            size: {
              width: pageSize.width,
              height: pageSize.height,
            },
            margin: {
              top: margin,
              right: margin,
              bottom: margin,
              left: margin,
            },
          },
        },
        children,
      },
    ],
  });

  const raw = await Packer.toBuffer(docxDoc);
  return Buffer.from(raw);
}

function getManagedPlaywrightBrowsersDir(): string {
  return path.join(resolveAppDataDir(), "runtime", "playwright-browsers");
}

function buildMissingBrowserError(browsersDir: string): PdfBrowserMissingError {
  const installCommand = `PLAYWRIGHT_BROWSERS_PATH="${browsersDir}" npx playwright install chromium`;
  return new PdfBrowserMissingError(
    `Playwright Chromium runtime is not installed. Run \`${installCommand}\` (or \`npm run setup:pdf-browser\`) to enable PDF export.`,
    installCommand
  );
}

function isMissingExecutableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Executable doesn't exist") ||
    msg.includes("browserType.launch") ||
    msg.includes("Failed to launch") ||
    msg.includes("ENOENT")
  );
}

/**
 * Exports an already-rendered HTML string to a PDF Buffer using headless Playwright Chromium.
 * Blocks all external network requests during rendering.
 */
export async function exportHtmlToPdfBuffer(
  html: string,
  paperSize: PaperSize = "A4"
): Promise<Buffer> {
  const browsersDir =
    process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() ||
    getManagedPlaywrightBrowsersDir();

  if (
    !process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() &&
    fs.existsSync(/*turbopackIgnore: true*/ browsersDir)
  ) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir;
  }

  const overridePath = process.env.PDF_BROWSER_EXECUTABLE_PATH?.trim();
  if (overridePath && !fs.existsSync(/*turbopackIgnore: true*/ overridePath)) {
    throw buildMissingBrowserError(browsersDir);
  }

  const pw = await import("playwright");
  let executablePath = overridePath || "";
  if (!executablePath) {
    try {
      executablePath = pw.chromium.executablePath();
    } catch {
      throw buildMissingBrowserError(browsersDir);
    }
    if (!executablePath || !fs.existsSync(/*turbopackIgnore: true*/ executablePath)) {
      throw buildMissingBrowserError(browsersDir);
    }
  }

  let browser: Awaited<ReturnType<typeof pw.chromium.launch>> | null = null;
  try {
    try {
      browser = await pw.chromium.launch({
        headless: true,
        executablePath,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    } catch (err) {
      if (isMissingExecutableError(err)) {
        throw buildMissingBrowserError(browsersDir);
      }
      throw err;
    }

    const context = await browser.newContext({
      javaScriptEnabled: false,
    });
    try {
      const page = await context.newPage();
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url === "about:blank" || url.startsWith("data:")) {
          return route.continue();
        }
        return route.abort();
      });

      await page.setContent(html, { waitUntil: "load" });
      const pdfBytes = await page.pdf({
        format: paperSize,
        preferCSSPageSize: true,
        printBackground: true,
      });

      return Buffer.from(pdfBytes);
    } finally {
      await context.close();
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
