import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/Button";
import { Input } from "./ui/input";
import { Icon } from "./icons";
import { apiFetch } from "@/lib/api";

interface SetupProps {
  onComplete: () => void;
}

type SetupStep = 'welcome' | 'anythingllm' | 'service-check' | 'testing' | 'complete';

export default function Setup({ onComplete }: SetupProps) {
  const [currentStep, setCurrentStep] = React.useState<SetupStep>('welcome');
  const [loading, setLoading] = React.useState(false);
  
  // AnythingLLM Configuration
  const [apiUrl, setApiUrl] = React.useState<string>("http://localhost:3001");
  const [apiKey, setApiKey] = React.useState<string>("");
  const [urlTouched, setUrlTouched] = React.useState(false);
  const [keyTouched, setKeyTouched] = React.useState(false);
  
  // Connection Status
  const [ping, setPing] = React.useState<string>("unknown");
  const [auth, setAuth] = React.useState<string>("unknown");
  
  // Error Messages
  const [connectionError, setConnectionError] = React.useState<string | null>(null);
  
  // Service Check Status
  const [serviceRunning, setServiceRunning] = React.useState<boolean | null>(null);
  const [checkingService, setCheckingService] = React.useState(false);

  const urlValid = React.useMemo(() => {
    try {
      const u = (apiUrl || '').trim();
      if (!u) return false;
      const parsed = new URL(u);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch { return false }
  }, [apiUrl]);

  const keyValid = React.useMemo(() => {
    const v = (apiKey || '').trim();
    return /^(?:[A-Za-z0-9]{7}-){3}[A-Za-z0-9]{7}$/.test(v);
  }, [apiKey]);

  const canProceed = urlValid && keyValid;

  async function testConnection() {
    setLoading(true);
    setCurrentStep('testing');
    setConnectionError(null);
    
    try {
      // Save settings first
      const saveResponse = await apiFetch(`/api/settings`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          anythingLLMUrl: (apiUrl||'').trim() || undefined, 
          anythingLLMKey: (apiKey||'').trim() || undefined 
        }) 
      });
      
      // Verify settings were saved
      if (!saveResponse.ok) {
        throw new Error('Failed to save settings');
      }
      
      // Small delay to ensure file write completes (production builds)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Test ping
      const pingResponse = await apiFetch(`/api/anythingllm/ping`);
      setPing(pingResponse.status === 200 ? "ok" : String(pingResponse.status));

      // Test auth
      const authResponse = await apiFetch(`/api/anythingllm/auth`);
      setAuth(authResponse.status === 200 ? "ok" : String(authResponse.status));

      if (pingResponse.status === 200 && authResponse.status === 200) {
        setTimeout(() => setCurrentStep('complete'), 1000);
      } else {
        // Set specific error messages based on what failed
        if (pingResponse.status !== 200) {
          setConnectionError("Cannot reach AnythingLLM service. Please check the URL and ensure AnythingLLM is running.");
        } else if (authResponse.status === 401 || authResponse.status === 403) {
          setConnectionError("Authentication failed. Please check your API key is correct and try again.");
        } else {
          setConnectionError(`Connection failed with status ${authResponse.status}. Please verify your settings.`);
        }
      }
    } catch (error) {
      console.error('Connection test failed:', error);
      setPing("error");
      setAuth("error");
      setConnectionError("Connection test failed. Please check your network connection and settings.");
    } finally {
      setLoading(false);
    }
  }

  function completeSetup() {
    // Mark setup as completed in localStorage
    localStorage.setItem('docsmith-setup-completed', 'true');
    
    // Notify Electron main process if we're running in Electron
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.setupCompleted().catch(console.error);
      window.electronAPI.restoreWindow().catch(console.error);
    }
    
    onComplete();
  }

  async function checkAnythingLLMService() {
    setCheckingService(true);
    setServiceRunning(null);
    
    try {
      // Try auto-discovery first
      const discoverResponse = await apiFetch(`/api/settings/discover-anythingllm`, { 
        method: 'POST'
      });
      
      const discoverData = await discoverResponse.json();
      
      if (discoverData.success && discoverData.url) {
        // Auto-discovery succeeded, update UI
        setApiUrl(discoverData.url);
        setServiceRunning(true);
        return;
      }
      
      // Fallback: Try manual check with provided URL
      await apiFetch(`/api/settings`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          anythingLLMUrl: apiUrl.trim() || 'http://localhost:3001', 
          anythingLLMKey: apiKey.trim() || undefined 
        }) 
      });

      const response = await apiFetch(`/api/anythingllm/ping`);
      
      if (response.status === 200) {
        setServiceRunning(true);
      } else {
        setServiceRunning(false);
      }
    } catch (error) {
      console.error('Service check failed:', error);
      setServiceRunning(false);
    } finally {
      setCheckingService(false);
    }
  }

  function renderStepIndicator() {
    const steps = [
      { key: 'welcome', label: 'Welcome' },
      { key: 'service-check', label: 'Service Check' },
      { key: 'anythingllm', label: 'Configure' },
      { key: 'testing', label: 'Testing' },
      { key: 'complete', label: 'Complete' }
    ];

    const currentIndex = steps.findIndex(s => s.key === currentStep);

    return (
      <div className="flex items-center justify-center mb-8">
        {steps.map((step, index) => (
          <React.Fragment key={step.key}>
            <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
              index <= currentIndex 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-200 text-gray-600'
            }`}>
              {index + 1}
            </div>
            {index < steps.length - 1 && (
              <div className={`w-12 h-0.5 mx-2 ${
                index < currentIndex ? 'bg-blue-500' : 'bg-gray-200'
              }`} />
            )}
          </React.Fragment>
        ))}
      </div>
    );
  }

  const isElectron = typeof window !== 'undefined' && window.electronAPI;

  return (
    <div className={isElectron ? "h-screen w-screen flex items-center justify-center" : "min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-8"}>
      <Card className={isElectron ? "w-full h-full max-w-none m-0 border-0 rounded-none" : "w-full max-w-2xl mx-auto"}>
        <CardHeader className={`text-center py-6 ${isElectron ? 'drag-region cursor-move relative' : ''}`}>
          <div className="flex items-center justify-center mb-4">
            <Icon.FileText className="w-10 h-10 text-blue-500" />
          </div>
          <CardTitle className="text-xl">DocSmith Setup</CardTitle>
          <CardDescription className="text-sm">
            Let's get your document management system ready
          </CardDescription>
          
          {/* Window controls for Electron */}
          {isElectron && (
            <div className="absolute top-4 right-4 flex items-center space-x-1 no-drag">
              <button
                onClick={() => window.electronAPI?.minimizeApp()}
                className="w-6 h-6 flex items-center justify-center hover:bg-black/10 rounded text-gray-600 hover:text-gray-800 transition-colors"
                title="Minimize"
              >
                <Icon.Minus className="w-3 h-3" />
              </button>
              <button
                onClick={() => window.electronAPI?.closeApp()}
                className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white rounded text-gray-600 transition-colors"
                title="Close"
              >
                <Icon.X className="w-3 h-3" />
              </button>
            </div>
          )}
        </CardHeader>
      
        <CardContent className={`pb-6 ${isElectron ? 'no-drag' : ''}`}>
          {renderStepIndicator()}
          
          {currentStep === 'welcome' && (
            <div className="text-center space-y-4">
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Welcome to DocSmith!</h3>
                <p className="text-gray-600 text-sm max-w-lg mx-auto">
                  DocSmith is a powerful document management and generation system that helps you create, 
                  organize, and manage your documents with AI assistance.
                </p>
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <Icon.FileText className="w-6 h-6 text-blue-500 mx-auto mb-1" />
                    <h4 className="font-medium text-blue-900 text-xs">Document Generation</h4>
                    <p className="text-xs text-blue-700">Create documents from templates</p>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <Icon.Users className="w-6 h-6 text-green-500 mx-auto mb-1" />
                    <h4 className="font-medium text-green-900 text-xs">Customer Management</h4>
                    <p className="text-xs text-green-700">Organize customer information</p>
                  </div>
                  <div className="text-center p-3 bg-purple-50 rounded-lg">
                    <Icon.Bot className="w-6 h-6 text-purple-500 mx-auto mb-1" />
                    <h4 className="font-medium text-purple-900 text-xs">AI Integration</h4>
                    <p className="text-xs text-purple-700">Powered by AnythingLLM</p>
                  </div>
                </div>
              </div>
              <Button onClick={() => setCurrentStep('service-check')} className="w-full">
                Get Started
              </Button>
            </div>
          )}

          {currentStep === 'service-check' && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <h3 className="text-xl font-semibold">Check AnythingLLM Service</h3>
                <p className="text-gray-600">
                  Let's verify that AnythingLLM is running and accessible
                </p>
              </div>

              <div className="space-y-4">
                {checkingService && (
                  <div className="text-center space-y-3">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p className="text-gray-600">Checking AnythingLLM service...</p>
                  </div>
                )}

                {!checkingService && serviceRunning === true && (
                  <div className="text-center space-y-4">
                    <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                      <Icon.Check className="w-6 h-6 text-green-600" />
                    </div>
                    <p className="text-green-700 font-medium">AnythingLLM service is running!</p>
                    <p className="text-gray-600 text-sm">
                      Great! We found AnythingLLM running. Now let's configure the connection.
                    </p>
                  </div>
                )}

                {!checkingService && serviceRunning === false && (
                  <div className="text-center space-y-4">
                    <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                      <Icon.X className="w-6 h-6 text-red-600" />
                    </div>
                    <p className="text-red-700 font-medium">AnythingLLM service not found</p>
                    <p className="text-gray-600 text-sm">
                      Could not reach AnythingLLM at: <code className="bg-gray-100 px-2 py-1 rounded text-xs">{apiUrl}</code>
                    </p>
                    <div className="p-3 bg-gray-50 border border-gray-200 rounded text-left text-sm">
                      <p className="font-medium text-gray-700 mb-2">Troubleshooting:</p>
                      <ul className="text-gray-600 space-y-1 text-xs">
                        <li>• Ensure AnythingLLM is installed and running</li>
                        <li>• Check that it's running on the correct port (default: 3001)</li>
                        <li>• Verify the URL is correct</li>
                        <li>• Try restarting AnythingLLM if it's installed</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex space-x-3">
                <Button 
                  variant="outline" 
                  onClick={() => setCurrentStep('welcome')}
                  className="flex-1"
                >
                  Back
                </Button>
                
                {serviceRunning === null || serviceRunning === false ? (
                  <Button 
                    onClick={checkAnythingLLMService}
                    disabled={checkingService}
                    className="flex-1"
                  >
                    {checkingService ? 'Checking...' : 'Check Service'}
                  </Button>
                ) : (
                  <Button 
                    onClick={() => setCurrentStep('anythingllm')}
                    className="flex-1"
                  >
                    Configure AI
                  </Button>
                )}
              </div>
            </div>
          )}

          {currentStep === 'anythingllm' && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <h3 className="text-xl font-semibold">Configure AI Service</h3>
                <p className="text-gray-600">
                  Connect to your AnythingLLM instance to enable AI-powered features
                </p>
              </div>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">AnythingLLM URL</label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          const response = await apiFetch('/api/settings/discover-anythingllm', { method: 'POST' });
                          const data = await response.json();
                          if (data.success && data.url) {
                            setApiUrl(data.url);
                            setUrlTouched(true);
                          }
                        } catch (error) {
                          console.error('Auto-discovery failed:', error);
                        }
                      }}
                      className="text-xs"
                    >
                      <Icon.Refresh className="w-3 h-3 mr-1" />
                      Auto-detect
                    </Button>
                  </div>
                  <Input
                    value={apiUrl}
                    onChange={(e) => {
                      setApiUrl(e.target.value);
                      setUrlTouched(true);
                    }}
                    placeholder="http://localhost:3001"
                    className={urlTouched && !urlValid ? "border-red-500" : ""}
                  />
                  {urlTouched && !urlValid && (
                    <p className="text-sm text-red-500">Please enter a valid URL</p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">API Key</label>
                  <Input
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyTouched(true);
                    }}
                    placeholder="XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX"
                    type="password"
                    className={keyTouched && !keyValid ? "border-red-500" : ""}
                  />
                  {keyTouched && !keyValid && (
                    <p className="text-sm text-red-500">Please enter a valid API key format</p>
                  )}
                </div>
                
                {!canProceed && (urlTouched || keyTouched) && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded text-left">
                    <div className="flex gap-3">
                      <Icon.AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                      <div className="text-left">
                        <p className="text-amber-800 font-medium text-sm mb-1">Don't have AnythingLLM?</p>
                        <p className="text-amber-700 text-sm mb-2">
                          Download and install AnythingLLM from the official website:
                        </p>
                        <a 
                          href="https://anythingllm.com/download" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="inline-flex items-center text-amber-800 hover:text-amber-900 font-medium text-sm underline"
                        >
                          Download AnythingLLM
                          <Icon.ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex space-x-3">
                <Button 
                  variant="outline" 
                  onClick={() => setCurrentStep('service-check')}
                  className="flex-1"
                >
                  Back
                </Button>
                <Button 
                  onClick={testConnection}
                  disabled={!canProceed || loading}
                  className="flex-1"
                >
                  {loading ? 'Testing...' : 'Test Connection'}
                </Button>
              </div>
            </div>
          )}

          {currentStep === 'testing' && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Testing Connection</h3>
                <p className="text-gray-600 dark:text-gray-400">Verifying your AnythingLLM configuration...</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Service Ping</span>
                    <div className="flex items-center space-x-2">
                      {ping === "unknown" && <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>}
                      {ping === "ok" && <Icon.Check className="w-4 h-4 text-green-500" />}
                      {ping !== "unknown" && ping !== "ok" && <Icon.X className="w-4 h-4 text-red-500" />}
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {ping === "unknown" ? "Testing..." : ping === "ok" ? "Success" : `Failed (${ping})`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Authentication</span>
                    <div className="flex items-center space-x-2">
                      {auth === "unknown" && <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>}
                      {auth === "ok" && <Icon.Check className="w-4 h-4 text-green-500" />}
                      {auth !== "unknown" && auth !== "ok" && <Icon.X className="w-4 h-4 text-red-500" />}
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {auth === "unknown" ? "Testing..." : auth === "ok" ? "Success" : `Failed (${auth})`}
                      </span>
                    </div>
                  </div>
                </div>

                {connectionError && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
                    <div className="flex gap-3">
                      <Icon.AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-red-800 dark:text-red-200 font-medium text-sm mb-1">Connection Failed</p>
                        <p className="text-red-700 dark:text-red-300 text-sm">{connectionError}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {connectionError && (
                <div className="flex space-x-3">
                  <Button 
                    variant="outline" 
                    onClick={() => setCurrentStep('anythingllm')}
                    className="flex-1"
                  >
                    Back to Configuration
                  </Button>
                  <Button 
                    onClick={testConnection}
                    disabled={loading}
                    className="flex-1"
                  >
                    Retry Test
                  </Button>
                </div>
              )}
            </div>
          )}

          {currentStep === 'complete' && (
            <div className="space-y-6 text-center">
              <div className="space-y-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                  <Icon.Check className="w-8 h-8 text-green-500" />
                </div>
                <h3 className="text-xl font-semibold">Setup Complete!</h3>
                <p className="text-gray-600">
                  DocSmith is now configured and ready to use. You can start creating documents, 
                  managing customers, and leveraging AI-powered features.
                </p>
              </div>
              
              <Button onClick={completeSetup} className="w-full">
                Start Using DocSmith
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}