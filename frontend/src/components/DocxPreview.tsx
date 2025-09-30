import * as React from "react";
import { renderAsync } from "docx-preview";
import JSZip from "jszip";
import { Card } from "./ui/card";
import { Button } from "./ui/Button";
import { Input } from "./ui/input";
import { FileText as FileTextIcon, FileSpreadsheet, ChevronLeft, ChevronRight, Minus, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Icon } from "./icons";

// Document metadata extracted from DOCX
interface DocxMetadata {
  pageWidth?: string;
  pageHeight?: string;
  marginTop?: string;
  marginBottom?: string;
  marginLeft?: string;
  marginRight?: string;
  orientation?: 'portrait' | 'landscape';
  defaultFont?: string;
  defaultSize?: string;
}

interface DocxPreviewProps {
  /** URL to fetch the document from */
  url: string;
  /** Document format (docx, xlsx, etc.) */
  format: 'docx' | 'xlsx' | string;
  /** Display name for the document */
  displayName?: string;
  /** Optional className for the container */
  className?: string;
  /** Show/hide the toolbar */
  showToolbar?: boolean;
}

export function DocxPreview({ 
  url, 
  format, 
  displayName = 'Document Preview',
  className = '',
  showToolbar = true
}: DocxPreviewProps) {
  const [loading, setLoading] = React.useState(true);
  const [docxData, setDocxData] = React.useState<ArrayBuffer | null>(null);
  const [docxMetadata, setDocxMetadata] = React.useState<DocxMetadata | null>(null);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [zoomLevel, setZoomLevel] = React.useState(100);
  const [pageElements, setPageElements] = React.useState<Element[]>([]);

  const docxPreviewRef = React.useRef<HTMLDivElement | null>(null);
  const viewerScrollRef = React.useRef<HTMLDivElement | null>(null);

  // Extract document metadata from DOCX file
  async function extractDocxMetadata(arrayBuffer: ArrayBuffer): Promise<DocxMetadata> {
    try {
      const zip = await JSZip.loadAsync(arrayBuffer);
      
      // Try to get document.xml to parse section properties
      const documentXml = await zip.file('word/document.xml')?.async('text');
      
      const metadata: DocxMetadata = {};
      
      // Parse document.xml for page setup (most reliable source)
      if (documentXml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(documentXml, 'text/xml');
        
        // Get page size and margins from section properties
        const sectPr = doc.querySelector('sectPr');
        if (sectPr) {
          const pgSz = sectPr.querySelector('pgSz');
          if (pgSz) {
            const width = pgSz.getAttribute('w:w');
            const height = pgSz.getAttribute('w:h');
            const orient = pgSz.getAttribute('w:orient');
            
            // Convert twips to pixels (1440 twips = 1 inch, 96 DPI)
            if (width) {
              const widthInches = parseInt(width) / 1440;
              metadata.pageWidth = `${widthInches}in`;
            }
            if (height) {
              const heightInches = parseInt(height) / 1440;
              metadata.pageHeight = `${heightInches}in`;
            }
            metadata.orientation = orient === 'landscape' ? 'landscape' : 'portrait';
          }
          
          const pgMar = sectPr.querySelector('pgMar');
          if (pgMar) {
            const top = pgMar.getAttribute('w:top');
            const bottom = pgMar.getAttribute('w:bottom');
            const left = pgMar.getAttribute('w:left');
            const right = pgMar.getAttribute('w:right');
            
            if (top) metadata.marginTop = `${parseInt(top) / 1440}in`;
            if (bottom) metadata.marginBottom = `${parseInt(bottom) / 1440}in`;
            if (left) metadata.marginLeft = `${parseInt(left) / 1440}in`;
            if (right) metadata.marginRight = `${parseInt(right) / 1440}in`;
          }
        }
      }
      
      // Parse styles.xml for default font
      const stylesXml = await zip.file('word/styles.xml')?.async('text');
      if (stylesXml) {
        const parser = new DOMParser();
        const stylesDoc = parser.parseFromString(stylesXml, 'text/xml');
        
        const defaultFont = stylesDoc.querySelector('docDefaults rPrDefault rPr rFonts');
        if (defaultFont) {
          const asciiFont = defaultFont.getAttribute('w:ascii');
          if (asciiFont) metadata.defaultFont = asciiFont;
        }
        
        const defaultSize = stylesDoc.querySelector('docDefaults rPrDefault rPr sz');
        if (defaultSize) {
          const size = defaultSize.getAttribute('w:val');
          // Font size in Word is in half-points, convert to points
          if (size) metadata.defaultSize = `${parseInt(size) / 2}pt`;
        }
      }
      
      return metadata;
    } catch (error) {
      console.error('Failed to extract DOCX metadata:', error);
      return {};
    }
  }

  // Load document from URL
  React.useEffect(() => {
    async function loadDocument() {
      if (!url) return;
      
      setLoading(true);
      
      try {
        if (format === 'xlsx') {
          toast.error('Excel preview not yet supported. Please download the file to view it.');
          setLoading(false);
          return;
        }
        
        if (format === 'docx') {
          const response = await fetch(url);
          const blob = await response.blob();
          const arrayBuffer = await blob.arrayBuffer();
          
          // Extract metadata from the DOCX file
          const metadata = await extractDocxMetadata(arrayBuffer);
          setDocxMetadata(metadata);
          setDocxData(arrayBuffer);
        }
      } catch (error) {
        console.error('Failed to load document:', error);
        toast.error('Failed to load document preview.');
      } finally {
        setLoading(false);
      }
    }

    loadDocument();
  }, [url, format]);

  // Render DOCX when data is available
  React.useEffect(() => {
    if (docxData && docxPreviewRef.current) {
      const container = docxPreviewRef.current;
      
      // Clear previous content
      container.innerHTML = '';
      
      // Reset page controls
      setCurrentPage(1);
      setTotalPages(1);
      setZoomLevel(100);
      
      // Render DOCX with all formatting preserved including page breaks
      renderAsync(docxData, container, undefined, {
        className: 'docx',
        inWrapper: false,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        experimental: true,
        trimXmlDeclaration: true,
        useBase64URL: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        debug: false
      })
        .then(() => {
          // First, try to find explicit section/page markers
          let sections: NodeListOf<Element> | Element[] = container.querySelectorAll('section.docx');
          
          if (sections.length === 0) {
            sections = container.querySelectorAll('section');
          }
          
          if (sections.length === 0) {
            sections = container.querySelectorAll('article');
          }
          
          // If we found explicit sections, use them
          if (sections.length > 0) {
            setTotalPages(sections.length);
            setPageElements(Array.from(sections));
            
            // Add page number attributes
            sections.forEach((section, index) => {
              section.setAttribute('data-page-number', String(index + 1));
            });
          } else {
            // No explicit sections - calculate pages from content height
            const pageHeightStr = docxMetadata?.pageHeight || '11in';
            const pageHeightInches = parseFloat(pageHeightStr);
            const pageHeightPx = pageHeightInches * 96; // 96 DPI
            
            const contentHeight = container.scrollHeight;
            const calculatedPages = Math.ceil(contentHeight / pageHeightPx);
            
            // Create virtual page markers
            if (calculatedPages > 1) {
              const allContent = container.innerHTML;
              container.innerHTML = '';
              
              for (let i = 0; i < calculatedPages; i++) {
                const section = document.createElement('section');
                section.className = 'docx-page';
                section.setAttribute('data-page-number', String(i + 1));
                section.style.minHeight = `${pageHeightPx}px`;
                
                if (i === 0) {
                  section.innerHTML = allContent;
                }
                
                container.appendChild(section);
              }
              
              const newSections = container.querySelectorAll('section.docx-page');
              setTotalPages(newSections.length);
              setPageElements(Array.from(newSections));
            } else {
              setTotalPages(1);
              setPageElements([container]);
            }
          }
        })
        .catch((error) => {
          console.error('DOCX rendering failed:', error);
          toast.error('Unable to preview this document.');
        });
    }
  }, [docxData, docxMetadata]);

  function goToPage(pageNum: number) {
    if (pageNum < 1 || pageNum > totalPages) return;
    
    const targetPage = pageElements[pageNum - 1];
    if (targetPage && viewerScrollRef.current) {
      const scrollTop = (targetPage as HTMLElement).offsetTop - 20;
      viewerScrollRef.current.scrollTo({ top: scrollTop, behavior: 'smooth' });
      setCurrentPage(pageNum);
    }
  }

  function handleZoom(direction: 'in' | 'out' | 'reset') {
    if (direction === 'reset') {
      setZoomLevel(100);
    } else if (direction === 'in') {
      setZoomLevel(prev => Math.min(prev + 10, 200));
    } else {
      setZoomLevel(prev => Math.max(prev - 10, 50));
    }
  }

  return (
    <Card className={`flex flex-col border-0 shadow-lg overflow-hidden ${className}`}>
      {loading ? (
        <div className="flex items-center justify-center h-full min-h-[400px]">
          <div className="text-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
            <div className="text-sm text-muted-foreground">Loading preview...</div>
          </div>
        </div>
      ) : format === 'docx' && docxData ? (
        <div className="h-full flex flex-col bg-muted/5">
          {/* PDF-style toolbar */}
          {showToolbar && (
            <div className="px-4 py-2 border-b border-border/40 bg-background/95 backdrop-blur">
              <div className="flex items-center justify-between gap-6">
                {/* Left: Document name */}
                <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                  <FileTextIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-foreground truncate whitespace-nowrap">
                    {displayName}
                  </span>
                </div>
                
                {/* Center: Page controls and zoom */}
                <div className="flex items-center gap-6 flex-shrink-0">
                  {/* Page navigation */}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage <= 1}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={totalPages}
                        value={currentPage}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '') return;
                          const page = parseInt(val);
                          if (!isNaN(page)) {
                            goToPage(page);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const page = parseInt(e.currentTarget.value);
                            if (!isNaN(page)) {
                              goToPage(page);
                            }
                          }
                        }}
                        className="h-8 w-14 text-center text-sm px-2"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        of {totalPages}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage >= totalPages}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Button>
                  </div>
                  
                  {/* Zoom controls */}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleZoom('out')}
                      disabled={zoomLevel <= 50}
                      className="h-8 w-8 p-0"
                    >
                      <Minus className="h-5 w-5" />
                    </Button>
                    <span className="text-sm text-muted-foreground min-w-[3rem] text-center whitespace-nowrap">
                      {zoomLevel}%
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleZoom('in')}
                      disabled={zoomLevel >= 200}
                      className="h-8 w-8 p-0"
                    >
                      <Plus className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
                
                {/* Right: Download button */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${displayName}.${format}`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                    className="h-7 px-3 whitespace-nowrap"
                  >
                    <Icon.Download className="h-4 w-4 mr-1.5" />
                    Download
                  </Button>
                </div>
              </div>
            </div>
          )}
          
          {/* Document viewer area */}
          <div 
            ref={viewerScrollRef}
            className="flex-1 overflow-auto" 
            style={{ backgroundColor: '#525659' }}
          >
            <div className="min-h-full flex justify-center py-8 px-4">
              <div 
                className="docx-viewer-container transition-transform duration-200"
                style={{
                  transform: `scale(${zoomLevel / 100})`,
                  transformOrigin: 'top center',
                  // Apply document metadata as CSS custom properties
                  ...(docxMetadata?.pageWidth && { '--docx-page-width': docxMetadata.pageWidth } as any),
                  ...(docxMetadata?.pageHeight && { '--docx-page-height': docxMetadata.pageHeight } as any),
                  ...(docxMetadata?.marginTop && { '--docx-margin-top': docxMetadata.marginTop } as any),
                  ...(docxMetadata?.marginBottom && { '--docx-margin-bottom': docxMetadata.marginBottom } as any),
                  ...(docxMetadata?.marginLeft && { '--docx-margin-left': docxMetadata.marginLeft } as any),
                  ...(docxMetadata?.marginRight && { '--docx-margin-right': docxMetadata.marginRight } as any),
                  ...(docxMetadata?.defaultFont && { '--docx-default-font': docxMetadata.defaultFont } as any),
                  ...(docxMetadata?.defaultSize && { '--docx-default-size': docxMetadata.defaultSize } as any),
                }}
              >
                <div ref={docxPreviewRef} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-full min-h-[400px] p-8">
          <div className="text-center space-y-3">
            <FileSpreadsheet className="h-16 w-16 mx-auto text-muted-foreground opacity-50" />
            <div className="text-sm text-muted-foreground max-w-md">
              Preview not available for this file type.
              <br />
              Please download the file to view it.
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
