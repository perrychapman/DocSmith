import * as React from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/Button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { Icon } from "../components/icons";
import { Separator } from "../components/ui/separator";

export default function HelpPage() {
  return (
    <div className="flex flex-col space-y-6 animate-in fade-in-0 slide-in-from-top-2 h-full">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="#customers">DocSmith</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Help</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon.AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Help & Documentation</h1>
              <p className="text-muted-foreground">Learn how to use DocSmith effectively</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-12 overflow-y-auto">
          <div className="space-y-8">
            
            {/* Getting Started */}
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Icon.Activity className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Getting Started</h2>
              </div>
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <h3 className="font-medium flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">1</span>
                      Set Up AnythingLLM Connection
                    </h3>
                    <p className="text-sm text-muted-foreground ml-8">
                      Configure your AnythingLLM connection in Settings to enable AI-powered document generation. This is required for workspace creation and AI assistance.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <h3 className="font-medium flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">2</span>
                      Create Your First Customer
                    </h3>
                    <p className="text-sm text-muted-foreground ml-8">
                      Add customers to organize your projects. Each customer gets their own workspace for AI conversations and document storage.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <h3 className="font-medium flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">3</span>
                      Create Templates
                    </h3>
                    <p className="text-sm text-muted-foreground ml-8">
                      Upload document templates (Word or Excel files) which are then compiled to generate TypeScript generators for dynamic content creation.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <h3 className="font-medium flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">4</span>
                      Generate Documents
                    </h3>
                    <p className="text-sm text-muted-foreground ml-8">
                      Use AI conversations and uploaded documents to generate customized documents for your customers using your templates.
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Core Features */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Customer Management Card */}
              <Card className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Icon.Users className="h-6 w-6 text-primary" />
                  <h3 className="text-lg font-semibold">Customer Management</h3>
                </div>
                <p className="text-muted-foreground mb-4">
                  Organize your projects by customer. Each customer gets their own dedicated AI workspace with document pinning, metadata extraction, and intelligent chat capabilities.
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Dedicated AnythingLLM workspace per customer</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Upload documents with automatic metadata extraction</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Pin important documents for priority AI context</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Track generated documents and chat history</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Integrated Jobs panel for generation monitoring</span>
                  </div>
                </div>
              </Card>

              {/* AI Workspaces Card */}
              <Card className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Icon.Bot className="h-6 w-6 text-primary" />
                  <h3 className="text-lg font-semibold">AI Workspaces</h3>
                </div>
                <p className="text-muted-foreground mb-4">
                  Powered by AnythingLLM, each workspace provides AI assistance with full context awareness of your customer's documents and project history.
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Context-aware AI conversations</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Document embedding and knowledge base</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Organized chat threads by topic</span>
                  </div>
                </div>
              </Card>

              {/* Templates Card */}
              <Card className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Icon.FileText className="h-6 w-6 text-primary" />
                  <h3 className="text-lg font-semibold">Smart Templates</h3>
                </div>
                <p className="text-muted-foreground mb-4">
                  Upload Word or Excel templates and let AI transform them into dynamic generators. Templates analyze structure, extract metadata, and intelligently incorporate workspace data.
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Supports DOCX and XLSX templates</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>AI compiles templates to TypeScript generators</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Automatic structure analysis and metadata extraction</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Preserves formatting, styles, and structure</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>15-minute cache for fast regeneration</span>
                  </div>
                </div>
              </Card>

              {/* Document Generation Card */}
              <Card className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Icon.File className="h-6 w-6 text-primary" />
                  <h3 className="text-lg font-semibold">Document Generation</h3>
                </div>
                <p className="text-muted-foreground mb-4">
                  Combine AI context with smart templates to generate customized documents. AI enhances templates with workspace data while preserving all formatting.
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>AI-powered content generation from workspace</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Real-time progress monitoring with job tracking</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>15-minute AI enhancement cache per workspace</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Pandoc-powered DOCX assembly (fallback to html-to-docx)</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon.Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <span>Automatic organization and customer-specific storage</span>
                  </div>
                </div>
              </Card>
            </div>

            {/* AnythingLLM Integration */}
            <Card className="p-6 border-2 border-primary/20">
              <div className="flex items-center gap-3 mb-4">
                <Icon.Bot className="h-6 w-6 text-primary" />
                <h2 className="text-xl font-semibold">AnythingLLM Integration</h2>
                <Badge variant="outline" className="ml-auto">Required</Badge>
              </div>
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  DocSmith requires an AnythingLLM instance for AI-powered workspaces and document generation. 
                  AnythingLLM provides the conversational AI and document embedding capabilities.
                </p>
                
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <h3 className="font-medium">Setup Requirements</h3>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Icon.Check className="h-4 w-4 text-green-600" />
                        <span>AnythingLLM Desktop or Server running</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Icon.Check className="h-4 w-4 text-green-600" />
                        <span>Auto-detection finds Desktop instances automatically</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Icon.Check className="h-4 w-4 text-green-600" />
                        <span>API key generated in AnythingLLM settings</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Icon.Check className="h-4 w-4 text-green-600" />
                        <span>LLM provider configured in AnythingLLM</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <h3 className="font-medium">Documentation & Resources</h3>
                    <div className="space-y-2">
                      <a 
                        href="https://docs.anythingllm.com/" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        <Icon.ExternalLink className="h-4 w-4" />
                        Official AnythingLLM Documentation
                      </a>
                      <a 
                        href="https://docs.anythingllm.com/installation/overview" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        <Icon.ExternalLink className="h-4 w-4" />
                        Installation Guide
                      </a>
                      <a 
                        href="https://docs.anythingllm.com/setup/llm-configuration" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        <Icon.ExternalLink className="h-4 w-4" />
                        LLM Provider Setup
                      </a>
                      <a 
                        href="https://github.com/Mintplex-Labs/anything-llm" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        <Icon.ExternalLink className="h-4 w-4" />
                        GitHub Repository
                      </a>
                    </div>
                  </div>
                </div>
                
                <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <Icon.AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-blue-900 dark:text-blue-100">Auto-Detection Feature</h4>
                      <p className="text-sm text-blue-700 dark:text-blue-200 mt-1">
                        DocSmith automatically detects AnythingLLM Desktop instances on startup. Use the "Auto-detect" button in Settings or Setup to find your AnythingLLM instance. The app scans common ports and automatically configures the connection for you.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Icon.Send className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Typical Workflow</h2>
              </div>
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium mt-1">1</div>
                  <div>
                    <h3 className="font-medium mb-1">Prepare Templates</h3>
                    <p className="text-sm text-muted-foreground">Create and upload document templates (Word/Excel files). The system analyzes structure, extracts metadata, and compiles them into TypeScript generators that dynamically incorporate workspace data.</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium mt-1">2</div>
                  <div>
                    <h3 className="font-medium mb-1">Add Customer & Context</h3>
                    <p className="text-sm text-muted-foreground">Create a customer profile with linked AnythingLLM workspace. Upload relevant documents to build their AI knowledge base - metadata is automatically extracted and documents can be pinned for priority context.</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium mt-1">3</div>
                  <div>
                    <h3 className="font-medium mb-1">Gather Requirements</h3>
                    <p className="text-sm text-muted-foreground">Use the AI workspace chat to discuss project details and gather necessary information. The AI has full context from uploaded documents and can query specific data points.</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium mt-1">4</div>
                  <div>
                    <h3 className="font-medium mb-1">Generate Documents</h3>
                    <p className="text-sm text-muted-foreground">Select appropriate templates and generate customized documents. AI enhances templates with workspace-specific data while preserving all formatting. Monitor progress in real-time via the Jobs panel.</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium mt-1">5</div>
                  <div>
                    <h3 className="font-medium mb-1">Review & Deliver</h3>
                    <p className="text-sm text-muted-foreground">Review generated documents, make any necessary adjustments, and deliver to your customer.</p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Tips & Best Practices */}
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <Icon.Magic className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Tips & Best Practices</h2>
              </div>
              
              <div className="grid gap-4 md:grid-cols-2">
                {/* Best Practices Card */}
                <Card className="p-6 border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 mb-4">
                    <Icon.Check className="h-5 w-5 text-green-600" />
                    <h3 className="font-medium text-green-800 dark:text-green-200">Recommended Practices</h3>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 mt-2 shrink-0"></div>
                      <span>Pin critical documents for priority AI context during generation</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 mt-2 shrink-0"></div>
                      <span>Use Auto-detect to find AnythingLLM Desktop instances automatically</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 mt-2 shrink-0"></div>
                      <span>Review template metadata extraction results before first use</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 mt-2 shrink-0"></div>
                      <span>Use descriptive template names and organize them logically</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 mt-2 shrink-0"></div>
                      <span>Monitor job progress for long-running document generations</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 mt-2 shrink-0"></div>
                      <span>Clean temp files periodically to free disk space</span>
                    </div>
                  </div>
                </Card>
                
                {/* Things to Avoid Card */}
                <Card className="p-6 border-red-200 dark:border-red-800">
                  <div className="flex items-center gap-2 mb-4">
                    <Icon.X className="h-5 w-5 text-red-600" />
                    <h3 className="font-medium text-red-800 dark:text-red-200">Common Pitfalls</h3>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-2 shrink-0"></div>
                      <span>Generating without uploading workspace context documents</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-2 shrink-0"></div>
                      <span>Ignoring template metadata extraction results</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-2 shrink-0"></div>
                      <span>Not linking customer to workspace before generation</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-2 shrink-0"></div>
                      <span>Using overly complex document structures for templates</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-2 shrink-0"></div>
                      <span>Deleting customers with important historical data</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-2 shrink-0"></div>
                      <span>Letting temp files accumulate (use Clean Temp Files)</span>
                    </div>
                  </div>
                </Card>
              </div>
            </div>

            {/* Technical Information */}
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Icon.FileText className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Technical Information</h2>
              </div>
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2">Template Structure</h3>
                  <div className="bg-muted/50 rounded-lg p-4 text-sm font-mono">
                    <div>data/templates/TemplateName/</div>
                    <div className="ml-4">├── template.docx <span className="text-muted-foreground"># Uploaded Word document</span></div>
                    <div className="ml-4">├── template.xlsx <span className="text-muted-foreground"># Uploaded Excel document (optional)</span></div>
                    <div className="ml-4">├── generator.full.ts <span className="text-muted-foreground"># Generated TypeScript code</span></div>
                    <div className="ml-4">├── template.json <span className="text-muted-foreground"># Auto-generated metadata</span></div>
                    <div className="ml-4">└── .cache/ <span className="text-muted-foreground"># AI-enhanced generators (per workspace)</span></div>
                    <div className="ml-8">└── generator.full.workspace-slug.ts <span className="text-muted-foreground"># 15-min cache</span></div>
                  </div>
                </div>
                
                <Separator />
                
                <div>
                  <h3 className="font-medium mb-2">Supported File Types</h3>
                  <div className="grid gap-2 md:grid-cols-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">DOCX</Badge>
                      <span className="text-sm text-muted-foreground">Word Documents</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">XLSX</Badge>
                      <span className="text-sm text-muted-foreground">Excel Spreadsheets</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">TXT/MD/HTML</Badge>
                      <span className="text-sm text-muted-foreground">Text-based outputs</span>
                    </div>
                  </div>
                </div>
                
                <Separator />
                
                <div>
                  <h3 className="font-medium mb-2">System Requirements</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>• <strong>AnythingLLM Desktop or Server:</strong> Auto-detected on common ports (3001, 3002, 64685) and Desktop range (50000-70000)</li>
                    <li>• <strong>Pandoc (optional):</strong> Preferred for DOCX assembly, fallback to html-to-docx if not installed</li>
                    <li>• <strong>Local storage:</strong> Data stored in %APPDATA%\DocSmith (production) or ./data (development)</li>
                    <li>• <strong>Internet connection:</strong> Required for AnythingLLM integration and AI features</li>
                  </ul>
                </div>
              </div>
            </Card>

            {/* Local Storage & Logs */}
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Icon.Folder className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Local Storage & Logs</h2>
              </div>
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2">Data Storage Locations</h3>
                  <div className="bg-muted/50 rounded-lg p-4 text-sm font-mono space-y-1">
                    <div><strong>Production:</strong> %APPDATA%\DocSmith\data\</div>
                    <div><strong>Development:</strong> ./data/ (project root)</div>
                    <div className="mt-2 text-muted-foreground">Structure:</div>
                    <div><strong>Customer Files:</strong> data/customers/CustomerName_Month_Year/</div>
                    <div><strong>Templates:</strong> data/templates/TemplateName/</div>
                    <div><strong>Database:</strong> data/app.sqlite</div>
                    <div><strong>Job Files:</strong> .jobs/jobs.json</div>
                    <div><strong>Temp Files:</strong> OS temp directory (cleaned via Settings)</div>
                  </div>
                </div>
                
                <div>
                  <h3 className="font-medium mb-2">Accessing Logs</h3>
                  <div className="space-y-3">
                    <div className="bg-muted/50 rounded-lg p-4">
                      <h4 className="font-medium mb-2">Application Logs</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        View detailed application logs for troubleshooting and debugging.
                      </p>
                      <div className="flex items-center gap-3">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            if (typeof window !== 'undefined' && window.electronAPI && (window.electronAPI as any).revealLogs) {
                              (window.electronAPI as any).revealLogs().then((result: any) => {
                                if (result.success) {
                                  // Success handled by toast in Settings
                                } else {
                                  console.error('Failed to reveal logs:', result.error);
                                }
                              }).catch(console.error);
                            }
                          }}
                          disabled={typeof window === 'undefined' || !window.electronAPI}
                        >
                          <Icon.ExternalLink className="h-4 w-4 mr-2" />
                          View Application Logs
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          Desktop app only
                        </span>
                      </div>
                    </div>
                    
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li>• <strong>Template Compilation:</strong> View detailed logs in Templates page during compilation</li>
                      <li>• <strong>Document Generation:</strong> Monitor progress and errors in Jobs page with real-time SSE updates</li>
                      <li>• <strong>Job History:</strong> Persistent job logs stored in .jobs/jobs.json with step tracking</li>
                      <li>• <strong>Metadata Extraction:</strong> Background process logs visible during document uploads</li>
                      <li>• <strong>Settings Access:</strong> Also available in Settings → Development Tools</li>
                    </ul>
                  </div>
                </div>
                
                <div>
                  <h3 className="font-medium mb-2">File Management</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>• Generated documents are automatically organized by customer folder (CustomerName_Month_Year)</li>
                    <li>• Use "Reveal in Explorer" buttons to access files directly in file system</li>
                    <li>• Template folders can be opened for manual inspection and cache management</li>
                    <li>• Customer uploads preserved in dedicated uploads/ subdirectory</li>
                    <li>• Document pinning prioritizes specific files for AI context during generation</li>
                    <li>• Temp file cleanup available in Settings (Pandoc, ts-node, html-to-docx caches)</li>
                  </ul>
                </div>
              </div>
            </Card>

            {/* Support */}
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Icon.Bot className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Need More Help?</h2>
              </div>
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  DocSmith is designed to be intuitive, but if you need additional assistance:
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>• Use <strong>Auto-detect</strong> in Settings to find AnythingLLM Desktop instances automatically</li>
                  <li>• Check the <strong>Jobs</strong> panel for real-time document generation progress and error logs</li>
                  <li>• Review <strong>document metadata extraction</strong> results to verify AI context quality</li>
                  <li>• Pin important documents in customer workspace for priority AI context</li>
                  <li>• Examine template compilation logs and metadata for detailed structure information</li>
                  <li>• Use <strong>Clean Temp Files</strong> in Settings if generation slows down or disk space is low</li>
                  <li>• Ensure customer has linked workspace before generating documents</li>
                </ul>
                <div className="flex items-center gap-2 pt-2">
                  <Icon.AlertTriangle className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-muted-foreground">
                    DocSmith stores data locally (%APPDATA%\DocSmith in production) and integrates with AnythingLLM for AI capabilities. All workspace data is cached for 15 minutes per template for fast regeneration.
                  </span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}