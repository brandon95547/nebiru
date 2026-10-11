import JSZip from 'jszip'
import { sectionsFromBlocks } from './sections'
import type { ParsedDocument, TextBlock } from './types'

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

function paragraphText(paragraph: Element): string {
  let text = ''
  const visit = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName
      if (tag === 'w:t') text += child.textContent ?? ''
      else if (tag === 'w:tab' || tag === 'w:br' || tag === 'w:cr') text += ' '
      else if (tag !== 'w:pPr' && tag !== 'w:rPr' && tag !== 'w:del') visit(child)
    }
  }
  visit(paragraph)
  return text.replace(/\s+/g, ' ').trim()
}

export async function parseDocx(data: ArrayBuffer): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(data)
  const main = zip.file('word/document.xml')
  if (!main) throw new Error('This file is not a Word document.')

  const doc = parseXml(await main.async('string'))
  const blocks: TextBlock[] = []
  let title: string | undefined

  for (const paragraph of Array.from(doc.getElementsByTagName('w:p'))) {
    const text = paragraphText(paragraph)
    if (!text) continue
    const style = paragraph.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') ?? ''
    const heading = /^heading\s*([1-6])$/i.exec(style)
    if (/^title$/i.test(style)) title ??= text
    else if (heading) blocks.push({ kind: 'heading', level: Number(heading[1]), text })
    else blocks.push({ kind: 'text', text })
  }

  let author: string | undefined
  const core = zip.file('docProps/core.xml')
  if (core) {
    const props = parseXml(await core.async('string'))
    title ??= props.getElementsByTagName('dc:title')[0]?.textContent?.trim() || undefined
    author = props.getElementsByTagName('dc:creator')[0]?.textContent?.trim() || undefined
  }

  return { title, author, sections: sectionsFromBlocks(blocks) }
}
