import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { Badge } from "./ui/badge";
import { Button } from "./ui/Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { RefreshCw, FileText, FileSpreadsheet, Zap, Target, Users, Layers } from "lucide-react";

export type TemplateMetadata = {
  id?: number;
  templateSlug: string;
  templateName: string;
  uploadedAt?: string;
  fileSize?: number;
  
  // Template characteristics
  templateType?: string;
  purpose?: string;
  outputFormat?: string;
  
  // Structure and requirements
  requiredDataTypes?: string[];
  expectedEntities?: string[];
  dataStructureNeeds?: string[];
  
  // Template content structure
  hasSections?: string[];
  hasCharts?: boolean;
  hasTables?: boolean;
  hasFormulas?: boolean;
  tableCount?: number;
  chartTypes?: string[];
  
  // Formatting and styling
  styleTheme?: string;
  colorScheme?: string;
  fontFamily?: string;
  pageOrientation?: string;
  
  // Content requirements
  requiresAggregation?: boolean;
  requiresTimeSeries?: boolean;
  requiresComparisons?: boolean;
  requiresFiltering?: boolean;
  
  // Metadata about the template itself
  complexity?: string;
  estimatedGenerationTime?: string;
  targetAudience?: string;
  useCases?: string[];
  
  // Relationships and compatibility
  compatibleDocumentTypes?: string[];
  recommendedWorkspaceSize?: string;
  
  // System metadata
  lastAnalyzed?: string;
  analysisVersion?: number;
  workspaceSlug?: string;
};

interface TemplateMetadataModalProps {
  metadata: TemplateMetadata | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry?: (templateSlug: string) => void;
}

export function TemplateMetadataModal({ metadata, open, onOpenChange, onRetry }: TemplateMetadataModalProps) {
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

  const getComplexityColor = (complexity?: string) => {
    if (!complexity) return 'secondary';
    const lower = complexity.toLowerCase();
    if (lower.includes('simple')) return 'default';
    if (lower.includes('moderate')) return 'secondary';
    if (lower.includes('complex')) return 'destructive';
    return 'secondary';
  };

  const getFormatIcon = (format?: string) => {
    if (format === 'xlsx' || format === 'excel') return <FileSpreadsheet className="h-4 w-4" />;
    return <FileText className="h-4 w-4" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-4xl h-[85vh] max-h-[800px] grid-rows-[auto_auto_1fr_auto] p-6 gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getFormatIcon(metadata.outputFormat)}
            Template Metadata
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between gap-3">
            <span className="truncate">{metadata.templateName}</span>
            <div className="flex items-center gap-2 shrink-0">
              {metadata.templateType && (
                <Badge variant="secondary">{metadata.templateType}</Badge>
              )}
              {metadata.complexity && (
                <Badge variant={getComplexityColor(metadata.complexity)}>{metadata.complexity}</Badge>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="overview" className="contents">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="requirements">Requirements</TabsTrigger>
            <TabsTrigger value="structure">Structure</TabsTrigger>
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

                {/* Target Audience & Use Cases */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {metadata.targetAudience && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Target Audience
                      </label>
                      <div className="rounded-md border bg-muted/30 p-3 text-sm">
                        {metadata.targetAudience}
                      </div>
                    </div>
                  )}

                  {metadata.estimatedGenerationTime && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Zap className="h-4 w-4" />
                        Generation Time
                      </label>
                      <div className="rounded-md border bg-muted/30 p-3 text-sm">
                        {metadata.estimatedGenerationTime}
                      </div>
                    </div>
                  )}
                </div>

                {/* Use Cases */}
                {metadata.useCases && metadata.useCases.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Use Cases</label>
                    <div className="flex flex-wrap gap-2">
                      {metadata.useCases.map((useCase, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {useCase}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Compatible Document Types */}
                {metadata.compatibleDocumentTypes && metadata.compatibleDocumentTypes.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Compatible with Documents</label>
                    <div className="flex flex-wrap gap-2">
                      {metadata.compatibleDocumentTypes.map((docType, idx) => (
                        <Badge key={idx} variant="default" className="text-xs">
                          {docType}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      This template works best with these document types in your workspace
                    </p>
                  </div>
                )}

                {/* Workspace Size Recommendation */}
                {metadata.recommendedWorkspaceSize && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Recommended Workspace Size</label>
                    <div className="rounded-md border bg-muted/30 p-3 text-sm">
                      {metadata.recommendedWorkspaceSize}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* REQUIREMENTS TAB */}
              <TabsContent value="requirements" className="space-y-4 mt-0 text-left">
                {/* Required Data Types */}
                {metadata.requiredDataTypes && metadata.requiredDataTypes.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Required Data Types</label>
                    <div className="flex flex-wrap gap-2">
                      {metadata.requiredDataTypes.map((dataType, idx) => (
                        <Badge key={idx} variant="default" className="text-xs">
                          {dataType}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      This template expects these types of data to be available
                    </p>
                  </div>
                )}

                {/* Expected Entities */}
                {metadata.expectedEntities && metadata.expectedEntities.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Expected Entities</label>
                    <div className="flex flex-wrap gap-2">
                      {metadata.expectedEntities.map((entity, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {entity}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Main subjects/objects this template expects to work with
                    </p>
                  </div>
                )}

                {/* Data Structure Needs */}
                {metadata.dataStructureNeeds && metadata.dataStructureNeeds.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Data Structure Needs</label>
                    <div className="flex flex-wrap gap-2">
                      {metadata.dataStructureNeeds.map((structure, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {structure}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      How data should be organized for this template
                    </p>
                  </div>
                )}

                {/* Operations Required */}
                {(metadata.requiresAggregation || metadata.requiresTimeSeries || metadata.requiresComparisons || metadata.requiresFiltering) && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Operations Required</label>
                    <div className="grid grid-cols-2 gap-2">
                      {metadata.requiresAggregation && (
                        <div className="rounded-md border bg-green-50 dark:bg-green-950/30 p-2 text-xs">
                          ✓ Aggregation (sums, averages, counts)
                        </div>
                      )}
                      {metadata.requiresTimeSeries && (
                        <div className="rounded-md border bg-green-50 dark:bg-green-950/30 p-2 text-xs">
                          ✓ Time-series ordering
                        </div>
                      )}
                      {metadata.requiresComparisons && (
                        <div className="rounded-md border bg-green-50 dark:bg-green-950/30 p-2 text-xs">
                          ✓ Comparisons (before/after)
                        </div>
                      )}
                      {metadata.requiresFiltering && (
                        <div className="rounded-md border bg-green-50 dark:bg-green-950/30 p-2 text-xs">
                          ✓ Data filtering/subsetting
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* STRUCTURE TAB */}
              <TabsContent value="structure" className="space-y-4 mt-0 text-left">
                {/* Sections */}
                {metadata.hasSections && metadata.hasSections.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Layers className="h-4 w-4" />
                      Sections
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {metadata.hasSections.map((section, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {section}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Content Elements */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Content Elements</label>
                  <div className="grid grid-cols-2 gap-2">
                    {metadata.hasTables !== undefined && (
                      <div className={`rounded-md border p-2 text-xs ${metadata.hasTables ? 'bg-green-50 dark:bg-green-950/30' : 'bg-muted/30'}`}>
                        {metadata.hasTables ? '✓' : '✗'} Tables
                        {metadata.tableCount !== undefined && metadata.tableCount > 0 && ` (${metadata.tableCount})`}
                      </div>
                    )}
                    {metadata.hasCharts !== undefined && (
                      <div className={`rounded-md border p-2 text-xs ${metadata.hasCharts ? 'bg-green-50 dark:bg-green-950/30' : 'bg-muted/30'}`}>
                        {metadata.hasCharts ? '✓' : '✗'} Charts
                      </div>
                    )}
                    {metadata.hasFormulas !== undefined && (
                      <div className={`rounded-md border p-2 text-xs ${metadata.hasFormulas ? 'bg-green-50 dark:bg-green-950/30' : 'bg-muted/30'}`}>
                        {metadata.hasFormulas ? '✓' : '✗'} Formulas
                      </div>
                    )}
                  </div>
                </div>

                {/* Chart Types */}
                {metadata.chartTypes && metadata.chartTypes.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Chart Types</label>
                    <div className="flex flex-wrap gap-2">
                      {metadata.chartTypes.map((chartType, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {chartType}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Styling */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {metadata.styleTheme && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Style Theme</label>
                      <div className="rounded-md border bg-muted/30 p-3 text-sm">
                        {metadata.styleTheme}
                      </div>
                    </div>
                  )}
                  {metadata.colorScheme && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Color Scheme</label>
                      <div className="rounded-md border bg-muted/30 p-3 text-sm">
                        {metadata.colorScheme}
                      </div>
                    </div>
                  )}
                  {metadata.fontFamily && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Font Family</label>
                      <div className="rounded-md border bg-muted/30 p-3 text-sm" style={{ fontFamily: metadata.fontFamily }}>
                        {metadata.fontFamily}
                      </div>
                    </div>
                  )}
                  {metadata.pageOrientation && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Page Orientation</label>
                      <div className="rounded-md border bg-muted/30 p-3 text-sm">
                        {metadata.pageOrientation}
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* TECHNICAL TAB */}
              <TabsContent value="technical" className="space-y-4 mt-0 text-left">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Template Slug</label>
                    <div className="rounded-md border bg-muted/30 p-3 text-xs font-mono break-all">
                      {metadata.templateSlug}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Output Format</label>
                    <div className="rounded-md border bg-muted/30 p-3 text-xs">
                      {metadata.outputFormat?.toUpperCase() || '-'}
                    </div>
                  </div>
                </div>

                {metadata.workspaceSlug && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">AnythingLLM Workspace</label>
                    <div className="rounded-md border bg-muted/30 p-3 text-xs font-mono break-all">
                      {metadata.workspaceSlug}
                    </div>
                  </div>
                )}

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
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>

        <DialogFooter>
          {onRetry && (
            <Button variant="secondary" onClick={() => onRetry(metadata.templateSlug)}>
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
