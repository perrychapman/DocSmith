import PizZip from 'pizzip'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const htmlToDocx = require('html-to-docx')

function extractBodyInner(docxXml: string): string {
  const m1 = docxXml.match(/<w:body[^>]*>([\s\S]*?)<w:sectPr[\s\S]*?<\/w:body>/)
  if (m1 && m1[1]) return m1[1]
  const m2 = docxXml.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/)
  return m2 && m2[1] ? m2[1] : ''
}

function findParagraphContaining(xml: string, text: string): { pStart: number; pEnd: number } | null {
  if (!text) return null
  const idx = xml.indexOf(text)
  if (idx === -1) return null
  const pStart = xml.lastIndexOf('<w:p', idx)
  const pEnd = xml.indexOf('</w:p>', idx)
  if (pStart === -1 || pEnd === -1) return null
  return { pStart, pEnd: pEnd + 6 }
}

export async function replaceAfterHeading(zip: PizZip, headingText: string, html: string) {
  const docFile = zip.file('word/document.xml')
  if (!docFile) return
  const xml = docFile.asText()
  const loc = findParagraphContaining(xml, headingText)
  if (!loc) return
  const genBuf: Buffer = await htmlToDocx(html)
  const genZip = new PizZip(genBuf)
  const genXml = genZip.file('word/document.xml')?.asText() || ''
  const bodyInner = extractBodyInner(genXml)
  if (!bodyInner) return
  const before = xml.slice(0, loc.pEnd)
  const after = xml.slice(loc.pEnd)
  const newXml = before + bodyInner + after
  zip.file('word/document.xml', newXml)
}

export function saveZip(zip: PizZip): Buffer {
  return zip.generate({ type: 'nodebuffer' })
}

