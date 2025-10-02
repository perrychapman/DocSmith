import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { Badge } from "./ui/badge";
import { Button } from "./ui/Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { 
  FileText, 
  FileSpreadsheet, 
  FileCode,
  Presentation,
  ChevronDown, 
  RefreshCw, 
  Target, 
  Users, 
  Calendar,
  BarChart3,
  Layers,
  Database
} from "lucide-react";

export type DocumentMetadata = {
  id?: number;
  customerId?: number;
  filename: string;
  uploadedAt?: string;
  fileSize?: number;
  documentType?: string;
  purpose?: string;
  keyTopics?: string[];
  dataCategories?: string[];
  mentionedSystems?: string[];
  stakeholders?: string[];
  departments?: string[];
  metrics?: string[];
  estimatedPageCount?: number;
  estimatedWordCount?: number;
  hasTables?: boolean;
  hasImages?: boolean;
  hasCodeSamples?: boolean;
  dateRange?: string;
  meetingDate?: string;
  relatedDocuments?: string[];
  supersedes?: string;
  tags?: string[];
  description?: string;
  extraFields?: Record<string, any>; // Document-type-specific fields
  lastAnalyzed?: string;
  analysisVersion?: number;
};

interface MetadataModalProps {
  metadata: DocumentMetadata | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry?: (filename: string) => void;
}

export function MetadataModal({ metadata, open, onOpenChange, onRetry }: MetadataModalProps) {
  const [expandedSchemas, setExpandedSchemas] = React.useState<Record<string, boolean>>({});

  if (!metadata) return null;

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return '-';
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getDocumentIcon = (docType?: string) => {
    if (!docType) return <FileText className="h-4 w-4" />;
    const lower = docType.toLowerCase();
    if (lower.includes('spreadsheet') || lower.includes('excel') || lower.includes('csv')) 
      return <FileSpreadsheet className="h-4 w-4" />;
    if (lower.includes('code') || lower.includes('script') || lower.includes('source'))
      return <FileCode className="h-4 w-4" />;
    if (lower.includes('presentation') || lower.includes('slide'))
      return <Presentation className="h-4 w-4" />;
    return <FileText className="h-4 w-4" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-4xl h-[85vh] max-h-[800px] grid-rows-[auto_auto_1fr_auto] p-6 gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getDocumentIcon(metadata.documentType)}
            Document Metadata
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between gap-3">
            <span className="truncate">{metadata.filename}</span>
            <div className="flex items-center gap-2 shrink-0">
              {metadata.documentType && (
                <Badge variant="secondary">{metadata.documentType}</Badge>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="overview" className="contents">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="content">Content</TabsTrigger>
            <TabsTrigger value="context">Context</TabsTrigger>
            <TabsTrigger value="technical">Technical</TabsTrigger>
          </TabsList>
          
          <ScrollArea className="min-h-0">
              <div className="pr-4">
                {/* OVERVIEW TAB */}
                <TabsContent value="overview" className="space-y-4 mt-0 text-left">
                  {/* Purpose */}
                  {metadata.purpose && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        Purpose
                      </label>
                      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground leading-relaxed">
                        {metadata.purpose}
                      </div>
                    </div>
                  )}

                  {/* Description */}
                  {metadata.description && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Description</label>
                      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground leading-relaxed">
                        {metadata.description}
                      </div>
                    </div>
                  )}

                  {/* Primary Entities & Data Structure */}
                  {(metadata.extraFields?.primaryEntities || metadata.extraFields?.dataStructure) && (
                    <div className="grid grid-cols-2 gap-3">
                      {metadata.extraFields?.primaryEntities && Array.isArray(metadata.extraFields.primaryEntities) && 
                      metadata.extraFields.primaryEntities.length > 0 && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Primary Entities</label>
                          <div className="flex flex-wrap gap-2">
                            {metadata.extraFields.primaryEntities.map((entity: string, idx: number) => (
                              <Badge key={idx} variant="default" className="text-xs">
                                {entity}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {metadata.extraFields?.dataStructure && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Data Structure</label>
                          <Badge variant="secondary" className="text-xs">{metadata.extraFields.dataStructure}</Badge>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Key Topics */}
                  {metadata.keyTopics && metadata.keyTopics.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Layers className="h-4 w-4" />
                        Key Topics
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {metadata.keyTopics.map((topic, idx) => (
                          <Badge key={idx} variant="default" className="text-xs">
                            {topic}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick Stats Grid */}
                  {(metadata.estimatedPageCount || metadata.estimatedWordCount || metadata.extraFields?.dataRowCount !== undefined || 
                    metadata.extraFields?.columnCount !== undefined || metadata.extraFields?.estimatedLineCount || metadata.extraFields?.slideCount) && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <BarChart3 className="h-4 w-4" />
                        Statistics
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        {metadata.estimatedPageCount && (
                          <div className="bg-muted/30 p-3 rounded-lg border">
                            <div className="text-xs text-muted-foreground mb-1">Estimated Pages</div>
                            <div className="text-xl font-semibold">{metadata.estimatedPageCount}</div>
                          </div>
                        )}
                        {metadata.estimatedWordCount && (
                          <div className="bg-muted/30 p-3 rounded-lg border">
                            <div className="text-xs text-muted-foreground mb-1">Word Count</div>
                            <div className="text-xl font-semibold">{metadata.estimatedWordCount.toLocaleString()}</div>
                          </div>
                        )}
                        {metadata.extraFields?.dataRowCount !== undefined && (
                          <div className="bg-muted/30 p-3 rounded-lg border">
                            <div className="text-xs text-muted-foreground mb-1">Total Rows</div>
                            <div className="text-xl font-semibold">{metadata.extraFields.dataRowCount.toLocaleString()}</div>
                          </div>
                        )}
                        {metadata.extraFields?.columnCount !== undefined && (
                          <div className="bg-muted/30 p-3 rounded-lg border">
                            <div className="text-xs text-muted-foreground mb-1">Columns</div>
                            <div className="text-xl font-semibold">{metadata.extraFields.columnCount}</div>
                          </div>
                        )}
                        {metadata.extraFields?.estimatedLineCount && (
                          <div className="bg-muted/30 p-3 rounded-lg border">
                            <div className="text-xs text-muted-foreground mb-1">Lines of Code</div>
                            <div className="text-xl font-semibold">{metadata.extraFields.estimatedLineCount.toLocaleString()}</div>
                          </div>
                        )}
                        {metadata.extraFields?.slideCount && (
                          <div className="bg-muted/30 p-3 rounded-lg border">
                            <div className="text-xs text-muted-foreground mb-1">Slides</div>
                            <div className="text-xl font-semibold">{metadata.extraFields.slideCount}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Document Features */}
                  {(metadata.hasTables || metadata.hasImages || metadata.hasCodeSamples || 
                    metadata.extraFields?.hasCharts || metadata.extraFields?.hasVideo) && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Features</label>
                      <div className="flex flex-wrap gap-2">
                        {metadata.hasTables && <Badge variant="outline">Tables</Badge>}
                        {metadata.hasImages && <Badge variant="outline">Images</Badge>}
                        {metadata.hasCodeSamples && <Badge variant="outline">Code Samples</Badge>}
                        {metadata.extraFields?.hasCharts && <Badge variant="outline">Charts</Badge>}
                        {metadata.extraFields?.hasVideo && <Badge variant="outline">Video</Badge>}
                        {metadata.extraFields?.hasFormulas && <Badge variant="outline">Formulas</Badge>}
                        {metadata.extraFields?.hasPivotTables && <Badge variant="outline">Pivot Tables</Badge>}
                        {metadata.extraFields?.hasTests && <Badge variant="outline">Tests</Badge>}
                        {metadata.extraFields?.hasDocumentation && <Badge variant="outline">Documentation</Badge>}
                      </div>
                    </div>
                  )}

                  {/* Dates */}
                  {(metadata.meetingDate || metadata.dateRange || metadata.extraFields?.presentationDate || 
                    metadata.extraFields?.timeframe || metadata.extraFields?.deadlines) && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Timeline
                      </label>
                      <div className="space-y-2 text-sm">
                        {metadata.meetingDate && (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">Meeting Date</Badge>
                            <span>{metadata.meetingDate}</span>
                          </div>
                        )}
                        {metadata.dateRange && (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">Date Range</Badge>
                            <span>{metadata.dateRange}</span>
                          </div>
                        )}
                        {metadata.extraFields?.presentationDate && (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">Presentation Date</Badge>
                            <span>{metadata.extraFields.presentationDate}</span>
                          </div>
                        )}
                        {metadata.extraFields?.timeframe && (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">Timeframe</Badge>
                            <span>{metadata.extraFields.timeframe}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* CONTENT TAB */}
                <TabsContent value="content" className="space-y-4 mt-0 text-left">
                  {/* Metrics */}
                  {metadata.metrics && metadata.metrics.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <BarChart3 className="h-4 w-4" />
                        Available Metrics
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {metadata.metrics.map((metric: string, idx: number) => (
                          <Badge key={idx} variant="default" className="text-xs">
                            {metric}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Quantitative measures and KPIs found in this document
                      </p>
                    </div>
                  )}

                  {/* Calculated Fields (spreadsheets) */}
                  {metadata.extraFields?.calculatedFields && Array.isArray(metadata.extraFields.calculatedFields) && 
                  metadata.extraFields.calculatedFields.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        Calculated Fields
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {metadata.extraFields.calculatedFields.map((field: string, idx: number) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {field}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Formulas and derived values in this document
                      </p>
                    </div>
                  )}

                  {/* Data Relationships (spreadsheets) */}
                  {metadata.extraFields?.dataRelationships && (
                    <div className="bg-muted/30 p-4 rounded-lg border">
                      <h4 className="text-sm font-semibold mb-2">Data Relationships</h4>
                      <p className="text-sm text-muted-foreground">{metadata.extraFields.dataRelationships}</p>
                    </div>
                  )}

                  {/* Timeframe & Geography */}
                  {(metadata.extraFields?.timeframe || metadata.extraFields?.geography || 
                    metadata.extraFields?.aggregationLevel) && (
                    <div className="grid grid-cols-3 gap-3">
                      {metadata.extraFields?.timeframe && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Timeframe</div>
                          <Badge variant="outline">{metadata.extraFields.timeframe}</Badge>
                        </div>
                      )}
                      {metadata.extraFields?.geography && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Geography</div>
                          <Badge variant="outline">{metadata.extraFields.geography}</Badge>
                        </div>
                      )}
                      {metadata.extraFields?.aggregationLevel && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Aggregation</div>
                          <Badge variant="outline">{metadata.extraFields.aggregationLevel}</Badge>
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>

                {/* CONTEXT TAB */}
                <TabsContent value="context" className="space-y-4 mt-0 text-left">
                  {/* Data Categories */}
                  {metadata.dataCategories && metadata.dataCategories.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Layers className="h-4 w-4" />
                        Data Categories
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {metadata.dataCategories.map((cat: string, idx: number) => (
                          <Badge key={idx} variant="default" className="text-xs">
                            {cat}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Types of data contained in this document
                      </p>
                    </div>
                  )}
                  
                  {/* Stakeholders */}
                  {metadata.stakeholders && metadata.stakeholders.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Stakeholders
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {metadata.stakeholders.map((person: string, idx: number) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {person}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Departments */}
                  {metadata.departments && metadata.departments.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Departments</label>
                      <div className="flex flex-wrap gap-2">
                        {metadata.departments.map((dept: string, idx: number) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {dept}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Mentioned Systems */}
                  {metadata.mentionedSystems && metadata.mentionedSystems.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Mentioned Systems</label>
                      <div className="flex flex-wrap gap-2">
                        {metadata.mentionedSystems.map((sys: string, idx: number) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {sys}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Industry */}
                  {metadata.extraFields?.industry && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Industry</label>
                      <div>
                        <Badge variant="secondary">{metadata.extraFields.industry}</Badge>
                      </div>
                    </div>
                  )}

                  {/* Related Documents */}
                  {metadata.relatedDocuments && metadata.relatedDocuments.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Related Documents</label>
                      <ul className="text-sm space-y-1">
                        {metadata.relatedDocuments.map((doc, idx) => (
                          <li key={idx} className="flex items-center gap-2">
                            <FileText className="h-3 w-3 text-muted-foreground" />
                            <span>{doc}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Tags */}
                  {metadata.tags && metadata.tags.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Tags</label>
                      <div className="flex flex-wrap gap-2">
                        {metadata.tags.map((tag, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            #{tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* TECHNICAL TAB */}
                <TabsContent value="technical" className="space-y-4 mt-0 text-left">
                  {/* File Information */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Filename</label>
                      <div className="rounded-md border bg-muted/30 p-3 text-xs font-mono break-all">
                        {metadata.filename}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Document Type</label>
                      <div className="rounded-md border bg-muted/30 p-3 text-xs">
                        {metadata.documentType || '-'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">File Size</label>
                      <div className="rounded-md border bg-muted/30 p-3 text-xs">
                        {formatFileSize(metadata.fileSize)}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Uploaded</label>
                      <div className="rounded-md border bg-muted/30 p-3 text-xs">
                        {formatDate(metadata.uploadedAt)}
                      </div>
                    </div>
                  </div>

                  {metadata.lastAnalyzed && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Last Analyzed</label>
                      <div className="rounded-md border bg-muted/30 p-3 text-xs">
                        {formatDate(metadata.lastAnalyzed)}
                        {metadata.analysisVersion && ` (v${metadata.analysisVersion})`}
                      </div>
                    </div>
                  )}
                  
                  {/* Data Categories */}
                  {metadata.dataCategories && metadata.dataCategories.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Data Categories</label>
                      <div className="flex flex-wrap gap-2">
                        {metadata.dataCategories.map((cat, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {cat}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Schemas (for spreadsheets) */}
                {metadata.extraFields?.schemas && Array.isArray(metadata.extraFields.schemas) && metadata.extraFields.schemas.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-3">Data Schemas</h4>
                    
                    <div className="space-y-3">{metadata.extraFields.schemas.map((schema: any, schemaIdx: number) => {
                        const schemaKey = `${metadata.filename}-${schemaIdx}`;
                        const isExpanded = expandedSchemas[schemaKey] ?? false; // All collapsed by default
                        const columnCount = schema.columns?.length || 0;
                        
                        const toggleExpanded = () => {
                          setExpandedSchemas(prev => ({
                            ...prev,
                            [schemaKey]: !isExpanded
                          }));
                        };
                        
                        return (
                          <div key={schemaIdx} className="border rounded-lg overflow-hidden">
                            {/* Schema Header - Clickable to expand/collapse */}
                            <button
                              onClick={toggleExpanded}
                              className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{schema.sheetName}</div>
                                {schema.tableName && (
                                  <div className="text-xs text-muted-foreground truncate">{schema.tableName}</div>
                                )}
                                {schema.headerRowIndex !== undefined && schema.headerRowIndex > 0 && (
                                  <div className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                                    ⚠ Data table starts at row {schema.headerRowIndex + 1}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-3 ml-3">
                                <Badge variant="outline" className="text-xs whitespace-nowrap">
                                  {columnCount} columns
                                </Badge>
                                <ChevronDown 
                                  className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                                />
                              </div>
                            </button>
                            
                            {/* Collapsible Column Details */}
                            {isExpanded && schema.columns && schema.columns.length > 0 && (
                              <div className="border-t bg-muted/20">
                                <div className="p-3 space-y-1.5 max-h-60 overflow-y-auto">
                                  {schema.columns.map((col: any, colIdx: number) => (
                                    <div key={colIdx} className="flex items-center justify-between text-xs py-1 px-2 hover:bg-muted/30 rounded">
                                      <span className="font-mono text-foreground">{col.name}</span>
                                      <div className="flex items-center gap-2">
                                        {col.dataType && (
                                          <Badge variant="secondary" className="text-xs capitalize">
                                            {col.dataType}
                                          </Badge>
                                        )}
                                        {col.nullable === false && (
                                          <Badge variant="outline" className="text-xs">Required</Badge>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Code Details */}
                {(metadata.extraFields?.codeType || metadata.extraFields?.programmingLanguage || 
                  metadata.extraFields?.framework || metadata.extraFields?.architecturePattern) && (
                  <div>
                    <h4 className="text-sm font-semibold mb-3">Code Details</h4>
                    <div className="grid grid-cols-2 gap-3">
                      {metadata.extraFields.programmingLanguage && (
                        <div className="bg-muted/30 p-3 rounded-lg">
                          <div className="text-xs text-muted-foreground mb-1">Language</div>
                          <Badge variant="default">{metadata.extraFields.programmingLanguage}</Badge>
                        </div>
                      )}
                      {metadata.extraFields.framework && (
                        <div className="bg-muted/30 p-3 rounded-lg">
                          <div className="text-xs text-muted-foreground mb-1">Framework</div>
                          <Badge variant="secondary">{metadata.extraFields.framework}</Badge>
                        </div>
                      )}
                      {metadata.extraFields.codeType && (
                        <div className="bg-muted/30 p-3 rounded-lg">
                          <div className="text-xs text-muted-foreground mb-1">Type</div>
                          <Badge variant="outline">{metadata.extraFields.codeType}</Badge>
                        </div>
                      )}
                      {metadata.extraFields.architecturePattern && (
                        <div className="bg-muted/30 p-3 rounded-lg">
                          <div className="text-xs text-muted-foreground mb-1">Architecture</div>
                          <Badge variant="outline">{metadata.extraFields.architecturePattern}</Badge>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Code Components */}
                {(metadata.extraFields?.keyOperations || metadata.extraFields?.apiEndpoints || 
                  metadata.extraFields?.databaseTables) && (
                  <div>
                    <h4 className="text-sm font-semibold mb-3">Code Components</h4>
                    <div className="space-y-3">
                      {metadata.extraFields.keyOperations && Array.isArray(metadata.extraFields.keyOperations) && 
                       metadata.extraFields.keyOperations.length > 0 && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1.5">Operations</div>
                          <div className="flex flex-wrap gap-2">
                            {metadata.extraFields.keyOperations.map((fn: string, idx: number) => (
                              <Badge key={idx} variant="default" className="text-xs font-mono">
                                {fn}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {metadata.extraFields.apiEndpoints && Array.isArray(metadata.extraFields.apiEndpoints) && 
                       metadata.extraFields.apiEndpoints.length > 0 && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1.5">API Endpoints</div>
                          <div className="flex flex-wrap gap-2">
                            {metadata.extraFields.apiEndpoints.map((api: string, idx: number) => (
                              <Badge key={idx} variant="secondary" className="text-xs font-mono">
                                {api}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {metadata.extraFields.databaseTables && Array.isArray(metadata.extraFields.databaseTables) && 
                       metadata.extraFields.databaseTables.length > 0 && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1.5">Database Tables</div>
                          <div className="flex flex-wrap gap-2">
                            {metadata.extraFields.databaseTables.map((table: string, idx: number) => (
                              <Badge key={idx} variant="default" className="text-xs font-mono">
                                {table}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Spreadsheet Technical Details */}
                {(metadata.extraFields?.dataType || metadata.extraFields?.timeframe || 
                  metadata.extraFields?.geography || metadata.extraFields?.aggregationLevel) && (
                  <div>
                    <h4 className="text-sm font-semibold mb-3">Data Details</h4>
                    <div className="space-y-2 text-sm">
                      {metadata.extraFields.dataType && (
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">Data Type</Badge>
                          <span>{metadata.extraFields.dataType}</span>
                        </div>
                      )}
                      {metadata.extraFields.timeframe && (
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">Timeframe</Badge>
                          <span>{metadata.extraFields.timeframe}</span>
                        </div>
                      )}
                      {metadata.extraFields.geography && (
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">Geography</Badge>
                          <span>{metadata.extraFields.geography}</span>
                        </div>
                      )}
                      {metadata.extraFields.aggregationLevel && (
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">Aggregation Level</Badge>
                          <span>{metadata.extraFields.aggregationLevel}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Calculated Fields */}
                {metadata.extraFields?.calculatedFields && Array.isArray(metadata.extraFields.calculatedFields) && 
                 metadata.extraFields.calculatedFields.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Calculated Fields</h4>
                    <div className="flex flex-wrap gap-2">
                      {metadata.extraFields.calculatedFields.map((field: string, idx: number) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {field}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Presentation Technical */}
                {(metadata.extraFields?.presentationType || metadata.extraFields?.targetAudience) && (
                  <div>
                    <h4 className="text-sm font-semibold mb-3">Presentation Details</h4>
                    <div className="grid grid-cols-2 gap-3">
                      {metadata.extraFields.presentationType && (
                        <div className="bg-muted/30 p-3 rounded-lg">
                          <div className="text-xs text-muted-foreground mb-1">Type</div>
                          <Badge variant="default">{metadata.extraFields.presentationType}</Badge>
                        </div>
                      )}
                      {metadata.extraFields.targetAudience && (
                        <div className="bg-muted/30 p-3 rounded-lg">
                          <div className="text-xs text-muted-foreground mb-1">Target Audience</div>
                          <span className="text-sm">{metadata.extraFields.targetAudience}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                  {/* File Metadata */}
                  <div className="pt-4 border-t">
                    <h4 className="text-sm font-semibold mb-2 text-muted-foreground">File Information</h4>
                    <div className="space-y-2 text-xs">
                      {metadata.uploadedAt && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Uploaded:</span>
                          <span>{new Date(metadata.uploadedAt).toLocaleString()}</span>
                        </div>
                      )}
                      {metadata.fileSize && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Size:</span>
                          <span>{(metadata.fileSize / 1024).toFixed(2)} KB</span>
                        </div>
                      )}
                      {metadata.lastAnalyzed && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Last Analyzed:</span>
                          <span>{new Date(metadata.lastAnalyzed).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>
              </div>
            </ScrollArea>
        </Tabs>
        
        <DialogFooter>
          {onRetry && (
            <Button variant="secondary" onClick={() => onRetry(metadata.filename)}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Re-analyze
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
