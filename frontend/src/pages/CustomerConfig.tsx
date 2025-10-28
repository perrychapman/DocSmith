// frontend/src/pages/CustomerConfig.tsx
import * as React from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';
import { Loader2, Check, X, Settings, ArrowLeft } from 'lucide-react';

interface SailpointEnvConfig {
  tenantUrl: string;
  clientId: string;
  clientSecret: string;
}

interface CustomerConfigProps {
  customerId: number;
  customerName?: string;
  onBack?: () => void;
}

export function CustomerConfigPage({ customerId, customerName, onBack }: CustomerConfigProps) {
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
  
  const [testResults, setTestResults] = React.useState<{
    sandbox?: boolean;
    prod?: boolean;
  }>({});

  const [hasExistingConfig, setHasExistingConfig] = React.useState(false);

  // Load existing configuration
  React.useEffect(() => {
    if (!customerId) return;
    
    setLoading(true);
    apiFetch(`/api/sailpoint/config/${customerId}`)
      .then(r => r.json())
      .then(data => {
        setHasExistingConfig(true);
        if (data.sandbox) {
          setSandbox({
            tenantUrl: data.sandbox.tenantUrl || '',
            clientId: data.sandbox.clientId || '',
            clientSecret: '' // Don't load secret
          });
        }
        if (data.prod) {
          setProd({
            tenantUrl: data.prod.tenantUrl || '',
            clientId: data.prod.clientId || '',
            clientSecret: '' // Don't load secret
          });
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
  }, [customerId]);

  async function handleSave() {
    // Check if at least one environment is configured
    const hasSandbox = sandbox.tenantUrl || sandbox.clientId || sandbox.clientSecret;
    const hasProd = prod.tenantUrl || prod.clientId || prod.clientSecret;
    
    if (!hasSandbox && !hasProd) {
      toast.error('At least one environment must be configured');
      return;
    }
    
    // Validate sandbox if any field is filled
    if (hasSandbox && (!sandbox.tenantUrl || !sandbox.clientId || !sandbox.clientSecret)) {
      toast.error('Sandbox configuration is incomplete - all fields required');
      return;
    }
    
    // Validate production if any field is filled
    if (hasProd && (!prod.tenantUrl || !prod.clientId || !prod.clientSecret)) {
      toast.error('Production configuration is incomplete - all fields required');
      return;
    }

    setSaving(true);
    try {
      const response = await apiFetch(`/api/sailpoint/config/${customerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sandbox: hasSandbox ? sandbox : null,
          prod: hasProd ? prod : null
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Save failed');
      }
      
      toast.success('Configuration saved successfully');
      setHasExistingConfig(true);
      
      // Don't clear secrets after save - keep them so user can test
      // Secrets will only be cleared on next page load
    } catch (error: any) {
      toast.error(`Failed to save: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(environment: 'sandbox' | 'prod') {
    const config = environment === 'sandbox' ? sandbox : prod;
    
    // Validate required fields
    if (!config.tenantUrl || !config.clientId || !config.clientSecret) {
      toast.error(`${environment} configuration is incomplete`);
      return;
    }

    setTesting(environment);
    try {
      const response = await apiFetch(`/api/sailpoint/${customerId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          environment,
          config: {
            tenantUrl: config.tenantUrl,
            clientId: config.clientId,
            clientSecret: config.clientSecret
          }
        })
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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <Settings className="h-6 w-6" />
        <div className="flex-1">
          <h2 className="text-2xl font-bold">SailPoint ISC Configuration</h2>
          <p className="text-sm text-muted-foreground">
            {customerName ? `Configure SailPoint environments for ${customerName}` : 'Configure SailPoint ISC environments'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Configure one or both environments as needed
          </p>
        </div>
      </div>

      <Tabs defaultValue="sandbox" className="w-full">
        <TabsList>
          <TabsTrigger value="sandbox">
            Sandbox
            {testResults.sandbox !== undefined && (
              <Badge 
                variant={testResults.sandbox ? 'default' : 'destructive'} 
                className="ml-2 h-5 w-5 p-0 flex items-center justify-center"
              >
                {testResults.sandbox ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="prod">
            Production
            {testResults.prod !== undefined && (
              <Badge 
                variant={testResults.prod ? 'default' : 'destructive'} 
                className="ml-2 h-5 w-5 p-0 flex items-center justify-center"
              >
                {testResults.prod ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sandbox" className="mt-4">
          <Card className="p-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sandbox-tenant-url">Tenant URL</Label>
              <Input
                id="sandbox-tenant-url"
                placeholder="https://yourcompany-sb.api.identitynow.com"
                value={sandbox.tenantUrl}
                onChange={(e) => setSandbox({ ...sandbox, tenantUrl: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Example: https://yourcompany-sb.api.identitynow.com
              </p>
            </div>

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
                placeholder={hasExistingConfig ? "••••••••" : "Enter client secret"}
                value={sandbox.clientSecret}
                onChange={(e) => setSandbox({ ...sandbox, clientSecret: e.target.value })}
              />
              {hasExistingConfig && !sandbox.clientSecret && (
                <p className="text-xs text-muted-foreground">
                  Leave empty to keep existing secret
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Button
                onClick={() => handleTest('sandbox')}
                disabled={!sandbox.tenantUrl || !sandbox.clientId || !sandbox.clientSecret || testing !== null}
                variant="outline"
              >
                {testing === 'sandbox' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Test Connection
              </Button>
              <p className="text-xs text-muted-foreground">
                You can test the connection before saving
              </p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="prod" className="mt-4">
          <Card className="p-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="prod-tenant-url">Tenant URL</Label>
              <Input
                id="prod-tenant-url"
                placeholder="https://yourcompany.api.identitynow.com"
                value={prod.tenantUrl}
                onChange={(e) => setProd({ ...prod, tenantUrl: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Example: https://yourcompany.api.identitynow.com
              </p>
            </div>

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
                placeholder={hasExistingConfig ? "••••••••" : "Enter client secret"}
                value={prod.clientSecret}
                onChange={(e) => setProd({ ...prod, clientSecret: e.target.value })}
              />
              {hasExistingConfig && !prod.clientSecret && (
                <p className="text-xs text-muted-foreground">
                  Leave empty to keep existing secret
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Button
                onClick={() => handleTest('prod')}
                disabled={!prod.tenantUrl || !prod.clientId || !prod.clientSecret || testing !== null}
                variant="outline"
              >
                {testing === 'prod' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Test Connection
              </Button>
              <p className="text-xs text-muted-foreground">
                You can test the connection before saving
              </p>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2">
        {onBack && (
          <Button onClick={onBack} variant="outline">
            Cancel
          </Button>
        )}
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Save Configuration
        </Button>
      </div>
    </div>
  );
}

export default CustomerConfigPage;
