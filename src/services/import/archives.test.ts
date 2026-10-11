import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseDocx } from './docx'
import { parseEpub } from './epub'

async function zipOf(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip()
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents)
  return zip.generateAsync({ type: 'arraybuffer' })
}

const chapter = (title: string, body: string) =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body><h1>${title}</h1>${body}</body></html>`

describe('parseEpub', () => {
  it('reads metadata and the spine in order, resolving paths from the package folder', async () => {
    const data = await zipOf({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml':
        '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
      'OEBPS/content.opf': `<?xml version="1.0"?>
        <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
          <metadata><dc:title>Sea Stories</dc:title><dc:creator>A. Mariner</dc:creator></metadata>
          <manifest>
            <item id="c2" href="text/two.xhtml" media-type="application/xhtml+xml"/>
            <item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/>
            <item id="css" href="style.css" media-type="text/css"/>
            <item id="ad" href="text/ad.xhtml" media-type="application/xhtml+xml"/>
          </manifest>
          <spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="ad" linear="no"/></spine>
        </package>`,
      'OEBPS/text/one.xhtml': chapter('The Harbour', '<p>Fog lay on the water.</p><p>Nobody spoke.</p>'),
      'OEBPS/text/two.xhtml': chapter('Open Sea', '<h2>Night watch</h2><p>The wind rose.</p>'),
      'OEBPS/text/ad.xhtml': chapter('More books', '<p>Buy them.</p>'),
    })

    const book = await parseEpub(data)
    expect(book.title).toBe('Sea Stories')
    expect(book.author).toBe('A. Mariner')
    expect(book.sections).toEqual([
      { title: 'The Harbour', paragraphs: ['Fog lay on the water.', 'Nobody spoke.'] },
      { title: 'Open Sea', paragraphs: ['Night watch', 'The wind rose.'] },
    ])
  })

  it('rejects an archive that is not an EPUB', async () => {
    await expect(parseEpub(await zipOf({ 'readme.txt': 'hello' }))).rejects.toThrow(/not an EPUB/)
  })
})

describe('parseDocx', () => {
  const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  const p = (text: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`

  it('reads headings, split runs and document properties', async () => {
    const data = await zipOf({
      'word/document.xml': `<?xml version="1.0"?><w:document ${w}><w:body>
        ${p('Garden Notes', 'Title')}
        ${p('Spring', 'Heading1')}
        <w:p><w:r><w:t xml:space="preserve">Seeds go </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>in early.</w:t></w:r></w:p>
        ${p('')}
        ${p('Summer', 'Heading1')}
        ${p('Water at dusk.')}
      </w:body></w:document>`,
      'docProps/core.xml':
        '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Rowan Green</dc:creator></cp:coreProperties>',
    })

    const doc = await parseDocx(data)
    expect(doc.title).toBe('Garden Notes')
    expect(doc.author).toBe('Rowan Green')
    expect(doc.sections).toEqual([
      { title: 'Spring', paragraphs: ['Seeds go in early.'] },
      { title: 'Summer', paragraphs: ['Water at dusk.'] },
    ])
  })

  it('rejects an archive that is not a Word document', async () => {
    await expect(parseDocx(await zipOf({ 'readme.txt': 'hello' }))).rejects.toThrow(/not a Word document/)
  })
})
