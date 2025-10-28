// frontend/src/components/SailpointConfigModal.tsx
import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/Button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { Checkbox } from './ui/checkbox';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';
import { Loader2, Check, X } from 'lucide-react';

interface SailpointEnvConfig {
  tenantUrl: string;
  clientId: string;
  clientSecret: string;
}

interface TenantInputState {
  tenantName: string; // Just the tenant name (e.g., "acme-corp" or "acme-corp-sb")
  useCustomUrl: boolean; // Whether to use a custom/vanity URL
  customUrl: string; // Full custom URL if useCustomUrl is true
}

interface SailpointConfigModalProps {
  customerId: number | null;
  customerName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SailpointConfigModal({ customerId, customerName, open, onOpenChange }: SailpointConfigModalProps) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState<'sandbox' | 'prod' | null>(null);
  
  const [sandbox, setSandbox] = React.useState<SailpointEnvConfig>({
    tenantUrl: '',
    clientId: '',
    clientSecret: ''
  });
  
  const [prod, setProd] = React.useState<SailpointEnvConfig>({
    tenantUrl: '',
    clientId: '',
    clientSecret: ''
  });

  // UI state for tenant name inputs
  const [sandboxInput, setSandboxInput] = React.useState<TenantInputState>({
    tenantName: '',
    useCustomUrl: false,
    customUrl: ''
  });

  const [prodInput, setProdInput] = React.useState<TenantInputState>({
    tenantName: '',
    useCustomUrl: false,
    customUrl: ''
  });
  
  const [testResults, setTestResults] = React.useState<{
    sandbox?: boolean;
    prod?: boolean;
  }>({});

  const [hasExistingConfig, setHasExistingConfig] = React.useState(false);

  // Helper to construct standard tenant URL from tenant name
  const constructTenantUrl = (tenantName: string, isSandbox: boolean): string => {
    const name = tenantName.trim();
    if (!name) return '';
    const suffix = isSandbox ? '-sb' : '';
    return `https://${name}${suffix}.api.identitynow.com`;
  };

  // Helper to parse tenant URL to extract tenant name
  const parseTenantUrl = (url: string): { tenantName: string; isStandard: boolean } => {
    if (!url) return { tenantName: '', isStandard: true };
    
    // Standard format: https://{tenant}.api.identitynow.com or https://{tenant}-sb.api.identitynow.com
    const standardMatch = url.match(/^https:\/\/([a-zA-Z0-9-]+?)(-sb)?\.api\.identitynow\.com\/?$/);
    if (standardMatch) {
      return { tenantName: standardMatch[1] + (standardMatch[2] || ''), isStandard: true };
    }
    
    // Not standard format (vanity URL)
    return { tenantName: '', isStandard: false };
  };

  // Update sandbox.tenantUrl when sandboxInput changes
  React.useEffect(() => {
    if (sandboxInput.useCustomUrl) {
      setSandbox(prev => ({ ...prev, tenantUrl: sandboxInput.customUrl }));
    } else {
      setSandbox(prev => ({ ...prev, tenantUrl: constructTenantUrl(sandboxInput.tenantName, true) }));
    }
  }, [sandboxInput]);

  // Update prod.tenantUrl when prodInput changes
  React.useEffect(() => {
    if (prodInput.useCustomUrl) {
      setProd(prev => ({ ...prev, tenantUrl: prodInput.customUrl }));
    } else {
      setProd(prev => ({ ...prev, tenantUrl: constructTenantUrl(prodInput.tenantName, false) }));
    }
  }, [prodInput]);

  // Load existing configuration when modal opens
  React.useEffect(() => {
    if (!customerId || !open) return;
    
    setLoading(true);
    // Reset state when opening
    setSandbox({ tenantUrl: '', clientId: '', clientSecret: '' });
    setProd({ tenantUrl: '', clientId: '', clientSecret: '' });
    setSandboxInput({ tenantName: '', useCustomUrl: false, customUrl: '' });
    setProdInput({ tenantName: '', useCustomUrl: false, customUrl: '' });
    setTestResults({});
    setHasExistingConfig(false);
    
    apiFetch(`/api/sailpoint/config/${customerId}`)
      .then(r => r.json())
      .then(data => {
        setHasExistingConfig(true);
        if (data.sandbox) {
          const parsed = parseTenantUrl(data.sandbox.tenantUrl || '');
          setSandbox({
            tenantUrl: data.sandbox.tenantUrl || '',
            clientId: data.sandbox.clientId || '',
            clientSecret: '••••••••' // Show placeholder for existing secret
          });
          setSandboxInput({
            tenantName: parsed.isStandard ? parsed.tenantName : '',
            useCustomUrl: !parsed.isStandard,
            customUrl: !parsed.isStandard ? data.sandbox.tenantUrl : ''
          });
          
          // Auto-test sandbox connection if config exists
          if (data.sandbox.tenantUrl && data.sandbox.clientId) {
            testExistingConnection('sandbox');
          }
        }
        if (data.prod) {
          const parsed = parseTenantUrl(data.prod.tenantUrl || '');
          setProd({
            tenantUrl: data.prod.tenantUrl || '',
            clientId: data.prod.clientId || '',
            clientSecret: '••••••••' // Show placeholder for existing secret
          });
          setProdInput({
            tenantName: parsed.isStandard ? parsed.tenantName : '',
            useCustomUrl: !parsed.isStandard,
            customUrl: !parsed.isStandard ? data.prod.tenantUrl : ''
          });
          
          // Auto-test prod connection if config exists
          if (data.prod.tenantUrl && data.prod.clientId) {
            testExistingConnection('prod');
          }
        }
      })
      .catch(err => {
        // 404 is expected for new customers
        if (!err.message?.includes('404')) {
          console.error('Failed to load SailPoint config:', err);
          toast.error('Failed to load configuration');
        }
      })
      .finally(() => setLoading(false));
  }, [customerId, open]);

  // Test existing connection using saved credentials (no inline config needed)
  async function testExistingConnection(environment: 'sandbox' | 'prod') {
    if (!customerId) return;
    
    try {
      const response = await apiFetch(`/api/sailpoint/${customerId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment })
      });
      
      const data = await response.json();
      setTestResults(prev => ({ ...prev, [environment]: data.success }));
    } catch (error: any) {
      // Silently fail for existing connections - don't show errors
      setTestResults(prev => ({ ...prev, [environment]: false }));
    }
  }

  async function handleSave() {
    if (!customerId) return;
    
    // Check if at least one environment is configured
    const hasSandbox = sandbox.tenantUrl || sandbox.clientId || sandbox.clientSecret;
    const hasProd = prod.tenantUrl || prod.clientId || prod.clientSecret;
    
    if (!hasSandbox && !hasProd) {
      toast.error('At least one environment must be configured');
      return;
    }
    
    // Helper to check if secret is placeholder
    const isPlaceholder = (secret: string) => secret === '••••••••';
    
    // Validate sandbox if any field is filled
    if (hasSandbox) {
      if (!sandbox.tenantUrl || !sandbox.clientId) {
        toast.error('Sandbox configuration is incomplete - tenant URL and client ID required');
        return;
      }
      // Secret is required only if not using existing (placeholder)
      if (!sandbox.clientSecret) {
        toast.error('Sandbox client secret is required');
        return;
      }
    }
    
    // Validate production if any field is filled
    if (hasProd) {
      if (!prod.tenantUrl || !prod.clientId) {
        toast.error('Production configuration is incomplete - tenant URL and client ID required');
        return;
      }
      // Secret is required only if not using existing (placeholder)
      if (!prod.clientSecret) {
        toast.error('Production client secret is required');
        return;
      }
    }

    setSaving(true);
    try {
      const response = await apiFetch(`/api/sailpoint/config/${customerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sandbox: hasSandbox ? {
            tenantUrl: sandbox.tenantUrl,
            clientId: sandbox.clientId,
            // Only send secret if it's not the placeholder (user changed it)
            clientSecret: isPlaceholder(sandbox.clientSecret) ? undefined : sandbox.clientSecret
          } : null,
          prod: hasProd ? {
            tenantUrl: prod.tenantUrl,
            clientId: prod.clientId,
            // Only send secret if it's not the placeholder (user changed it)
            clientSecret: isPlaceholder(prod.clientSecret) ? undefined : prod.clientSecret
          } : null
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Save failed');
      }
      
      toast.success('Configuration saved successfully');
      setHasExistingConfig(true);
      
      // Close the modal after successful save
      onOpenChange(false);
    } catch (error: any) {
      toast.error(`Failed to save: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(environment: 'sandbox' | 'prod') {
    if (!customerId) return;
    
    const config = environment === 'sandbox' ? sandbox : prod;
    
    // Validate required fields - allow placeholder secret if config exists
    const hasPlaceholderSecret = config.clientSecret === '••••••••';
    if (!config.tenantUrl || !config.clientId) {
      toast.error(`${environment} configuration is incomplete`);
      return;
    }
    
    if (!config.clientSecret) {
      toast.error(`${environment} client secret is required`);
      return;
    }

    setTesting(environment);
    try {
      // If using placeholder, test with saved credentials (no inline config)
      // Otherwise, send inline config for testing new credentials
      const response = await apiFetch(`/api/sailpoint/${customerId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          hasPlaceholderSecret 
            ? { environment } // Use saved credentials
            : { 
                environment,
                config: {
                  tenantUrl: config.tenantUrl,
                  clientId: config.clientId,
                  clientSecret: config.clientSecret
                }
              }
        )
      });
      
      const data = await response.json();
      
      setTestResults(prev => ({ ...prev, [environment]: data.success }));
      
      if (data.success) {
        toast.success(`${environment} connection successful`);
      } else {
        toast.error(`${environment} connection failed: ${data.error}`);
      }
    } catch (error: any) {
      setTestResults(prev => ({ ...prev, [environment]: false }));
      toast.error(`${environment} connection failed: ${error.message}`);
    } finally {
      setTesting(null);
    }
  }

  if (!customerId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-3xl h-[85vh] max-h-[800px] grid-rows-[auto_auto_1fr_auto] p-6 gap-4 overflow-hidden max-w-full">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex items-center gap-2">
            <img src="/sailpoint-icon.svg" alt="SailPoint ISC" className="h-5 w-5 dark:hidden" />
            <img src="/sailpoint-icon-dark.svg" alt="SailPoint ISC" className="h-5 w-5 hidden dark:block" />
            SailPoint ISC Configuration
          </DialogTitle>
          <div className="text-sm text-muted-foreground">
            {customerName ? `Configure SailPoint environments for ${customerName}` : 'Configure SailPoint ISC environments'}
          </div>
          <p className="text-xs text-muted-foreground">
            Configure one or both environments as needed
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <Tabs defaultValue="sandbox" className="contents min-w-0">
            <TabsList className="w-full justify-start overflow-x-auto flex-shrink-0">
              <TabsTrigger value="sandbox" className="flex items-center gap-2">
                Sandbox
                {testResults.sandbox !== undefined && (
                  <Badge 
                    variant={testResults.sandbox ? 'default' : 'destructive'} 
                    className="h-5 w-5 p-0 flex items-center justify-center"
                  >
                    {testResults.sandbox ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="prod" className="flex items-center gap-2">
                Production
                {testResults.prod !== undefined && (
                  <Badge 
                    variant={testResults.prod ? 'default' : 'destructive'} 
                    className="h-5 w-5 p-0 flex items-center justify-center"
                  >
                    {testResults.prod ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <ScrollArea className="min-h-0 overflow-hidden min-w-0 max-w-full">
              <div className="pr-4 w-full">
                <TabsContent value="sandbox" className="space-y-4 mt-0">
                  <div className="space-y-2">
                    <Label htmlFor="sandbox-tenant-name">Tenant Name</Label>
                    <Input
                      id="sandbox-tenant-name"
                      placeholder="acme-corp"
                      value={sandboxInput.tenantName}
                      onChange={(e) => setSandboxInput({ ...sandboxInput, tenantName: e.target.value })}
                      disabled={sandboxInput.useCustomUrl}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter your tenant name (e.g., "acme-corp"). The full URL will be: https://{sandboxInput.tenantName || 'yourcompany'}-sb.api.identitynow.com
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="sandbox-custom-url"
                      checked={sandboxInput.useCustomUrl}
                      onCheckedChange={(checked: boolean) => 
                        setSandboxInput({ 
                          ...sandboxInput, 
                          useCustomUrl: checked,
                          customUrl: checked ? sandbox.tenantUrl : ''
                        })
                      }
                    />
                    <Label htmlFor="sandbox-custom-url" className="text-sm font-normal cursor-pointer">
                      Use custom/vanity URL
                    </Label>
                  </div>

                  {sandboxInput.useCustomUrl && (
                    <div className="space-y-2">
                      <Label htmlFor="sandbox-custom-url-input">Custom Tenant URL</Label>
                      <Input
                        id="sandbox-custom-url-input"
                        placeholder="https://custom-domain.identitynow.com"
                        value={sandboxInput.customUrl}
                        onChange={(e) => setSandboxInput({ ...sandboxInput, customUrl: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Enter the full custom/vanity URL for your tenant
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="sandbox-client-id">Client ID</Label>
                    <Input
                      id="sandbox-client-id"
                      placeholder="abc123..."
                      value={sandbox.clientId}
                      onChange={(e) => setSandbox({ ...sandbox, clientId: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sandbox-client-secret">Client Secret</Label>
                    <Input
                      id="sandbox-client-secret"
                      type="password"
                      placeholder="Enter client secret"
                      value={sandbox.clientSecret}
                      onChange={(e) => setSandbox({ ...sandbox, clientSecret: e.target.value })}
                    />
                    {hasExistingConfig && sandbox.clientSecret === '••••••••' && (
                      <p className="text-xs text-muted-foreground">
                        Using saved secret. Change to update.
                      </p>
                    )}
                  </div>

                  <div className="pt-2">
                    <Button
                      onClick={() => handleTest('sandbox')}
                      disabled={!sandbox.tenantUrl || !sandbox.clientId || !sandbox.clientSecret || testing !== null}
                      variant="outline"
                      size="sm"
                    >
                      {testing === 'sandbox' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Test Connection
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2">
                      Test with {sandbox.clientSecret === '••••••••' ? 'saved' : 'current'} credentials
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="prod" className="space-y-4 mt-0">
                  <div className="space-y-2">
                    <Label htmlFor="prod-tenant-name">Tenant Name</Label>
                    <Input
                      id="prod-tenant-name"
                      placeholder="acme-corp"
                      value={prodInput.tenantName}
                      onChange={(e) => setProdInput({ ...prodInput, tenantName: e.target.value })}
                      disabled={prodInput.useCustomUrl}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter your tenant name (e.g., "acme-corp"). The full URL will be: https://{prodInput.tenantName || 'yourcompany'}.api.identitynow.com
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="prod-custom-url"
                      checked={prodInput.useCustomUrl}
                      onCheckedChange={(checked: boolean) => 
                        setProdInput({ 
                          ...prodInput, 
                          useCustomUrl: checked,
                          customUrl: checked ? prod.tenantUrl : ''
                        })
                      }
                    />
                    <Label htmlFor="prod-custom-url" className="text-sm font-normal cursor-pointer">
                      Use custom/vanity URL
                    </Label>
                  </div>

                  {prodInput.useCustomUrl && (
                    <div className="space-y-2">
                      <Label htmlFor="prod-custom-url-input">Custom Tenant URL</Label>
                      <Input
                        id="prod-custom-url-input"
                        placeholder="https://custom-domain.identitynow.com"
                        value={prodInput.customUrl}
                        onChange={(e) => setProdInput({ ...prodInput, customUrl: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Enter the full custom/vanity URL for your tenant
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="prod-client-id">Client ID</Label>
                    <Input
                      id="prod-client-id"
                      placeholder="xyz789..."
                      value={prod.clientId}
                      onChange={(e) => setProd({ ...prod, clientId: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="prod-client-secret">Client Secret</Label>
                    <Input
                      id="prod-client-secret"
                      type="password"
                      placeholder="Enter client secret"
                      value={prod.clientSecret}
                      onChange={(e) => setProd({ ...prod, clientSecret: e.target.value })}
                    />
                    {hasExistingConfig && prod.clientSecret === '••••••••' && (
                      <p className="text-xs text-muted-foreground">
                        Using saved secret. Change to update.
                      </p>
                    )}
                  </div>

                  <div className="pt-2">
                    <Button
                      onClick={() => handleTest('prod')}
                      disabled={!prod.tenantUrl || !prod.clientId || !prod.clientSecret || testing !== null}
                      variant="outline"
                      size="sm"
                    >
                      {testing === 'prod' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Test Connection
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2">
                      Test with {prod.clientSecret === '••••••••' ? 'saved' : 'current'} credentials
                    </p>
                  </div>
                </TabsContent>
              </div>
            </ScrollArea>
          </Tabs>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
