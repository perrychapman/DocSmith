import PizZip from 'pizzip'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const htmlToDocx = require('html-to-docx')

function readTxt(zip: PizZip, path: string): string { try { return zip.file(path)?.asText() || '' } catch { return '' } }
function writeTxt(zip: PizZip, path: string, content: string) { zip.file(path, content) }
function ensureContentTypeForImages(ctXml: string, ext: string, contentType: string): string {
  if (new RegExp(`<Default[^>]+Extension=\\"${ext}\\"`).test(ctXml)) return ctXml
  const insertAt = ctXml.indexOf('</Types>')
  if (insertAt === -1) return ctXml
  const line = `<Default Extension="${ext}" ContentType="${contentType}"/>`
  return ctXml.slice(0, insertAt) + line + ctXml.slice(insertAt)
}

function extractBodyInner(xml: string): { inner: string; hasSectPr: boolean } {
  const bodyOpen = xml.match(/<w:body[^>]*>/)
  if (!bodyOpen) return { inner: '', hasSectPr: false }
  const startIdx = (bodyOpen.index || 0) + bodyOpen[0].length
  const sectMatch = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)
  const bodyCloseIdx = xml.lastIndexOf('</w:body>')
  if (sectMatch && sectMatch.index != null && sectMatch.index > startIdx) {
    const inner = xml.slice(startIdx, sectMatch.index)
    return { inner, hasSectPr: true }
  }
  if (bodyCloseIdx > startIdx) {
    const inner = xml.slice(startIdx, bodyCloseIdx)
    return { inner, hasSectPr: false }
  }
  return { inner: '', hasSectPr: false }
}

export async function mergeHtmlIntoDocxTemplate(templateDocx: Buffer, html: string): Promise<Buffer> {
  try {
    // Prefer Pandoc with reference doc if available for higher fidelity
    const pandocOk = (() => {
      try {
        const r = spawnSync('pandoc', ['-v'], { encoding: 'utf-8' })
        return (r.status === 0)
      } catch { return false }
    })()

    if (pandocOk) {
      try {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docsmith-pandoc-'))
        const htmlPath = path.join(tmp, 'input.html')
        const refPath = path.join(tmp, 'ref.docx')
        const outPath = path.join(tmp, 'out.docx')
        fs.writeFileSync(htmlPath, html, 'utf-8')
        fs.writeFileSync(refPath, templateDocx)
        const args = [htmlPath, '-o', outPath, '--reference-doc', refPath]
        const r = spawnSync('pandoc', args, { encoding: 'utf-8' })
        if (r.status === 0 && fs.existsSync(outPath)) {
          const buf = fs.readFileSync(outPath)
          try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
          return buf
        }
        try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
      } catch { /* fall back to html-to-docx path below */ }
    }

    const genBuf: Buffer = await htmlToDocx(html)
    const tZip = new PizZip(templateDocx)
    const gZip = new PizZip(genBuf)
    const tXml = tZip.file('word/document.xml')?.asText() || ''
    const gXml = gZip.file('word/document.xml')?.asText() || ''
    if (!tXml || !gXml) return genBuf

    let { inner: genInner } = extractBodyInner(gXml)
    if (!genInner || !/(<w:p|<w:tbl)/.test(genInner)) return genBuf

    // Replace template body inner while preserving sectPr and existing document preamble, styles, and relationships
    const bodyOpen = tXml.match(/<w:body[^>]*>/)
    if (!bodyOpen) return genBuf
    const startIdx = (bodyOpen.index || 0) + bodyOpen[0].length
    const sectMatch = tXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)
    const endIdx = sectMatch && sectMatch.index != null ? sectMatch.index : tXml.lastIndexOf('</w:body>')
    if (endIdx <= startIdx) return genBuf
    // Best-effort: copy image relationships and media from generated DOCX and rewrite rIds in the fragment
    try {
      const tRelsPath = 'word/_rels/document.xml.rels'
      const gRelsPath = 'word/_rels/document.xml.rels'
      const tRels = readTxt(tZip, tRelsPath)
      const gRels = readTxt(gZip, gRelsPath)
      if (tRels && gRels) {
        const ridNums = Array.from(tRels.matchAll(/Id=\"rId(\d+)\"/g)).map(m => parseInt(m[1]!, 10)).filter(n => !isNaN(n))
        let nextRid = (ridNums.length ? Math.max(...ridNums) : 1) + 1
        let tRelsOut = tRels
        let ctXml = readTxt(tZip, '[Content_Types].xml')
        const addCT = (ext: string, typ: string) => { ctXml = ensureContentTypeForImages(ctXml, ext, typ) }
        const relRe = /<Relationship\s+[^>]*Id=\"([^\"]+)\"[^>]*Type=\"([^\"]+)\"[^>]*Target=\"([^\"]+)\"[^>]*?\/>/g
        let m: RegExpExecArray | null
        while ((m = relRe.exec(gRels))) {
          const [ , oldId, type, target ] = m
          if (/officeDocument\/[\w\-]+\/image/.test(type)) {
            const relTarget = target.replace(/^\.\//, '')
            const mediaRel = relTarget.startsWith('media/') ? relTarget : ('media/' + relTarget.replace(/^.*\//, ''))
            const gMediaPath = 'word/' + mediaRel
            const gFile = gZip.file(gMediaPath)
            if (gFile) {
              const ext = (gMediaPath.split('.').pop() || '').toLowerCase()
              if (ext === 'png') addCT('png', 'image/png')
              if (ext === 'jpg' || ext === 'jpeg') addCT('jpeg', 'image/jpeg')
              if (ext === 'gif') addCT('gif', 'image/gif')
              // choose a non-conflicting media path
              let finalMediaPath = gMediaPath
              let counter = 1
              while (tZip.file(finalMediaPath)) {
                const base = gMediaPath.replace(/\.[^.]+$/, '')
                const ex = gMediaPath.slice(base.length)
                finalMediaPath = `${base}_${counter++}${ex}`
              }
              tZip.file(finalMediaPath, gFile.asUint8Array())
              const newId = `rId${nextRid++}`
              const targetShort = finalMediaPath.replace(/^word\//, '')
              const insertAt = tRelsOut.indexOf('</Relationships>')
              if (insertAt !== -1) {
                const relTag = `<Relationship Id="${newId}" Type="${type}" Target="${targetShort}"/>`
                tRelsOut = tRelsOut.slice(0, insertAt) + relTag + tRelsOut.slice(insertAt)
                // Replace r:embed OR r:link occurrences for this id in fragment
                genInner = genInner.replace(new RegExp(`r:(?:embed|link)=\\\"${oldId}\\\"`, 'g'), `r:embed="${newId}"`)
              }
            }
          }
        }
        if (tRelsOut !== tRels) writeTxt(tZip, tRelsPath, tRelsOut)
        if (ctXml) writeTxt(tZip, '[Content_Types].xml', ctXml)
      }
    } catch { /* ignore best-effort media merge failures */ }

    const newXml = tXml.slice(0, startIdx) + genInner + tXml.slice(endIdx)
    tZip.file('word/document.xml', newXml)
    return tZip.generate({ type: 'nodebuffer' })
  } catch {
    // Fallback to generated docx if anything fails
    const genBuf: Buffer = await htmlToDocx(html)
    return genBuf
  }
}

export async function mergeDocxIntoDocxTemplate(templateDocx: Buffer, generatedDocx: Buffer): Promise<Buffer> {
  try {
    const tZip = new PizZip(templateDocx)
    const gZip = new PizZip(generatedDocx)
    const tXml = tZip.file('word/document.xml')?.asText() || ''
    const gXml = gZip.file('word/document.xml')?.asText() || ''
    if (!tXml || !gXml) return generatedDocx
    let { inner: genInner } = extractBodyInner(gXml)
    if (!genInner || !/(<w:p|<w:tbl)/.test(genInner)) return generatedDocx

    const bodyOpen = tXml.match(/<w:body[^>]*>/)
    if (!bodyOpen) return generatedDocx
    const startIdx = (bodyOpen.index || 0) + bodyOpen[0].length
    const sectMatch = tXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)
    const endIdx = sectMatch && sectMatch.index != null ? sectMatch.index : tXml.lastIndexOf('</w:body>')
    if (endIdx <= startIdx) return generatedDocx

    // Media/relationships merge (best-effort)
    try {
      const tRelsPath = 'word/_rels/document.xml.rels'
      const gRelsPath = 'word/_rels/document.xml.rels'
      const tRels = readTxt(tZip as any, tRelsPath)
      const gRels = readTxt(gZip as any, gRelsPath)
      if (tRels && gRels) {
        const ridNums = Array.from(tRels.matchAll(/Id=\"rId(\d+)\"/g)).map(m => parseInt(m[1]!, 10)).filter(n => !isNaN(n))
        let nextRid = (ridNums.length ? Math.max(...ridNums) : 1) + 1
        let tRelsOut = tRels
        let ctXml = readTxt(tZip as any, '[Content_Types].xml')
        const addCT = (ext: string, typ: string) => { ctXml = ensureContentTypeForImages(ctXml, ext, typ) }
        const relRe = /<Relationship\s+[^>]*Id=\"([^\"]+)\"[^>]*Type=\"([^\"]+)\"[^>]*Target=\"([^\"]+)\"[^>]*?\/>/g
        let m: RegExpExecArray | null
        while ((m = relRe.exec(gRels))) {
          const [ , oldId, type, target ] = m
          if (/officeDocument\/[\w\-]+\/image/.test(type)) {
            const relTarget = target.replace(/^\.\//, '')
            const mediaRel = relTarget.startsWith('media/') ? relTarget : ('media/' + relTarget.replace(/^.*\//, ''))
            const gMediaPath = 'word/' + mediaRel
            const gFile = gZip.file(gMediaPath)
            if (gFile) {
              const ext = (gMediaPath.split('.').pop() || '').toLowerCase()
              if (ext === 'png') addCT('png', 'image/png')
              if (ext === 'jpg' || ext === 'jpeg') addCT('jpeg', 'image/jpeg')
              if (ext === 'gif') addCT('gif', 'image/gif')
              let finalMediaPath = gMediaPath
              let counter = 1
              while (tZip.file(finalMediaPath)) {
                const base = gMediaPath.replace(/\.[^.]+$/, '')
                const ex = gMediaPath.slice(base.length)
                finalMediaPath = `${base}_${counter++}${ex}`
              }
              tZip.file(finalMediaPath, gFile.asUint8Array())
              const newId = `rId${nextRid++}`
              const targetShort = finalMediaPath.replace(/^word\//, '')
              const insertAt = tRelsOut.indexOf('</Relationships>')
              if (insertAt !== -1) {
                const relTag = `<Relationship Id="${newId}" Type="${type}" Target="${targetShort}"/>`
                tRelsOut = tRelsOut.slice(0, insertAt) + relTag + tRelsOut.slice(insertAt)
                genInner = genInner.replace(new RegExp(`r:(?:embed|link)=\\\"${oldId}\\\"`, 'g'), `r:embed="${newId}"`)
              }
            }
          }
        }
        if (tRelsOut !== tRels) writeTxt(tZip as any, tRelsPath, tRelsOut)
        if (ctXml) writeTxt(tZip as any, '[Content_Types].xml', ctXml)
      }
    } catch {}

    const newXml = tXml.slice(0, startIdx) + genInner + tXml.slice(endIdx)
    tZip.file('word/document.xml', newXml)
    return tZip.generate({ type: 'nodebuffer' })
  } catch {
    return generatedDocx
  }
}
