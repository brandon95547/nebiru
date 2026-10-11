import JSZip from 'jszip'
import { extractBlocks, parseHtmlDocument } from './html'
import type { ParsedDocument, ParsedSection } from './types'

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

/** Resolve a manifest href against the folder holding the package file. */
function resolvePath(baseDir: string, href: string): string {
  const parts = (baseDir ? `${baseDir}/` : '').concat(decodeURIComponent(href.split('#')[0])).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return out.join('/')
}

function byLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((el) => el.localName === name)
}

export async function parseEpub(data: ArrayBuffer): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(data)
  const container = zip.file('META-INF/container.xml')
  if (!container) throw new Error('This file is not an EPUB.')

  const packagePath = byLocalName(parseXml(await container.async('string')), 'rootfile')[0]?.getAttribute('full-path')
  const packageFile = packagePath ? zip.file(packagePath) : null
  if (!packagePath || !packageFile) throw new Error('The EPUB has no package document.')

  const pkg = parseXml(await packageFile.async('string'))
  const baseDir = packagePath.includes('/') ? packagePath.slice(0, packagePath.lastIndexOf('/')) : ''

  const hrefs = new Map<string, string>()
  for (const item of byLocalName(pkg, 'item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    const type = item.getAttribute('media-type') ?? ''
    if (id && href && /html/.test(type)) hrefs.set(id, href)
  }

  const sections: ParsedSection[] = []
  for (const ref of byLocalName(pkg, 'itemref')) {
    if (ref.getAttribute('linear') === 'no') continue
    const href = hrefs.get(ref.getAttribute('idref') ?? '')
    const file = href ? zip.file(resolvePath(baseDir, href)) : null
    if (!file) continue

    // Each spine document is one section, titled by its first heading.
    const blocks = extractBlocks(parseHtmlDocument(await file.async('string')).body)
    const firstHeading = blocks.findIndex((b) => b.kind === 'heading')
    const title = firstHeading >= 0 ? blocks[firstHeading].text : null
    const paragraphs = blocks
      .filter((_, i) => i !== firstHeading)
      .map((b) => (b.kind === 'heading' ? `## ${b.text}` : b.text))
    if (paragraphs.length > 0) sections.push({ title, paragraphs })
  }

  return {
    title: byLocalName(pkg, 'title')[0]?.textContent?.trim() || undefined,
    author: byLocalName(pkg, 'creator')[0]?.textContent?.trim() || undefined,
    sections,
  }
}
