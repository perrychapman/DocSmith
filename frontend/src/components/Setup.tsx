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
      await apiFetch(`/api/settings`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          anythingLLMUrl: (apiUrl||'').trim() || undefined, 
          anythingLLMKey: (apiKey||'').trim() || undefined 
        }) 
      });

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
    onComplete();
  }

  async function checkAnythingLLMService() {
    setCheckingService(true);
    setServiceRunning(null);
    
    try {
      // First, save the current settings (or defaults) so backend knows where to check
      await apiFetch(`/api/settings`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          anythingLLMUrl: apiUrl.trim() || 'http://localhost:3001', 
          anythingLLMKey: apiKey.trim() || undefined 
        }) 
      });

      // Use our backend API to check the service
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
      { id: 'welcome', label: 'Welcome', icon: 'Heart' },
      { id: 'service-check', label: 'Service', icon: 'Bot' },
      { id: 'anythingllm', label: 'AI Setup', icon: 'Settings' },
      { id: 'testing', label: 'Testing', icon: 'Activity' },
      { id: 'complete', label: 'Complete', icon: 'Check' }
    ];

    const currentIndex = steps.findIndex(s => s.id === currentStep);

    return (
      <div className="flex items-center justify-center space-x-4 mb-8">
        {steps.map((step, index) => {
          const IconComponent = Icon[step.icon as keyof typeof Icon];
          return (
            <div key={step.id} className="flex items-center">
              <div className={`
                flex items-center justify-center w-10 h-10 rounded-full border-2 transition-colors
                ${index <= currentIndex 
                  ? 'bg-blue-500 border-blue-500 text-white' 
                  : 'bg-gray-100 border-gray-300 text-gray-500'
                }
              `}>
                <IconComponent className="w-4 h-4" />
              </div>
              {index < steps.length - 1 && (
                <div className={`
                  w-12 h-0.5 mx-2 transition-colors
                  ${index < currentIndex ? 'bg-blue-500' : 'bg-gray-300'}
                `} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-8">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center py-8">
          <div className="flex items-center justify-center mb-6">
            <Icon.FileText className="w-12 h-12 text-blue-500" />
          </div>
          <CardTitle className="text-2xl">DocSmith Setup</CardTitle>
          <CardDescription>
            Let's get your document management system ready
          </CardDescription>
        </CardHeader>
        
        <CardContent className="pb-8 min-h-[500px]">
          {renderStepIndicator()}
          
          {currentStep === 'welcome' && (
            <div className="text-center space-y-6">
              <div className="space-y-4">
                <h3 className="text-xl font-semibold">Welcome to DocSmith!</h3>
                <p className="text-gray-600 max-w-lg mx-auto">
                  DocSmith is a powerful document management and generation system that helps you create, 
                  organize, and manage your documents with AI assistance.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                  <div className="text-center p-4 bg-blue-50 rounded-lg">
                    <Icon.FileText className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                    <h4 className="font-medium text-blue-900">Document Generation</h4>
                    <p className="text-sm text-blue-700">Create documents from templates</p>
                  </div>
                  <div className="text-center p-4 bg-green-50 rounded-lg">
                    <Icon.Users className="w-8 h-8 text-green-500 mx-auto mb-2" />
                    <h4 className="font-medium text-green-900">Customer Management</h4>
                    <p className="text-sm text-green-700">Organize customer information</p>
                  </div>
                  <div className="text-center p-4 bg-purple-50 rounded-lg">
                    <Icon.Bot className="w-8 h-8 text-purple-500 mx-auto mb-2" />
                    <h4 className="font-medium text-purple-900">AI Integration</h4>
                    <p className="text-sm text-purple-700">Powered by AnythingLLM</p>
                  </div>
                </div>
              </div>
              <Button onClick={() => setCurrentStep('service-check')} className="w-full">
                Get Started
              </Button>
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
                  <label className="text-sm font-medium">AnythingLLM URL</label>
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
                    <p className="text-sm text-red-500">
                      API key should be in format: XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX
                    </p>
                  )}
                  
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-blue-900 font-medium text-sm mb-2">How to find your API Key:</p>
                    <ol className="text-blue-800 text-xs space-y-1 list-decimal list-inside">
                      <li>Open AnythingLLM</li>
                      <li>Click the wrench icon in the bottom-right of the sidebar</li>
                      <li>Go to Tools → Developer API</li>
                      <li>Generate API Key if you don't already have one populated</li>
                      <li>Click "Copy API key" and paste into the field above</li>
                    </ol>
                  </div>
                </div>
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
                  Test Connection
                </Button>
              </div>
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
                {serviceRunning === null && !checkingService && (
                  <div className="text-center space-y-4">
                    <div className="p-6 bg-blue-50 border border-blue-200 rounded-lg">
                      <Icon.Bot className="w-12 h-12 text-blue-500 mx-auto mb-3" />
                      <h4 className="font-semibold text-blue-900 mb-2">AnythingLLM Required</h4>
                      <p className="text-blue-700 text-sm mb-3">
                        DocSmith requires AnythingLLM to be running for AI functionality. 
                        We'll check if it's running at: <code className="bg-blue-100 px-2 py-1 rounded text-xs">{apiUrl}</code>
                      </p>
                      <p className="text-blue-600 text-xs">
                        Make sure AnythingLLM is installed and running on your system.
                      </p>
                    </div>
                    
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="flex items-start space-x-3">
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
                  </div>
                )}
                
                {checkingService && (
                  <div className="text-center space-y-3">
                    <Icon.Clock className="w-8 h-8 text-blue-500 animate-spin mx-auto" />
                    <p className="text-gray-600">Checking AnythingLLM service...</p>
                    <p className="text-gray-500 text-sm">Looking for service at: {apiUrl}</p>
                  </div>
                )}
                
                {serviceRunning === true && (
                  <div className="text-center space-y-3">
                    <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                      <Icon.Check className="w-6 h-6 text-green-600" />
                    </div>
                    <p className="text-green-700 font-medium">AnythingLLM service is running!</p>
                    <p className="text-gray-600 text-sm">Found service at: {apiUrl}</p>
                    <p className="text-gray-600 text-sm">Ready to proceed with AI configuration.</p>
                  </div>
                )}
                
                {serviceRunning === false && (
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

          {currentStep === 'testing' && (
            <div className="space-y-6 text-center">
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Testing Connection...</h3>
                <p className="text-gray-600">
                  Verifying your AnythingLLM configuration
                </p>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <span className="text-gray-900 font-medium">Service Ping</span>
                  <div className="flex items-center space-x-2">
                    {ping === "unknown" && <Icon.Clock className="w-4 h-4 text-gray-600 animate-spin" />}
                    {ping === "ok" && <Icon.Check className="w-4 h-4 text-green-600" />}
                    {ping === "error" && <Icon.X className="w-4 h-4 text-red-600" />}
                    <span className="text-sm font-medium text-gray-900">{ping}</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <span className="text-gray-900 font-medium">Authentication</span>
                  <div className="flex items-center space-x-2">
                    {auth === "unknown" && <Icon.Clock className="w-4 h-4 text-gray-600 animate-spin" />}
                    {auth === "ok" && <Icon.Check className="w-4 h-4 text-green-600" />}
                    {auth === "error" && <Icon.X className="w-4 h-4 text-red-600" />}
                    <span className="text-sm font-medium text-gray-900">{auth}</span>
                  </div>
                </div>
                
                {connectionError && (
                  <div className="text-center space-y-4">
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                      <div className="text-center space-y-3">
                        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                          <Icon.AlertTriangle className="w-6 h-6 text-red-500" />
                        </div>
                        <div>
                          <p className="text-red-800 font-medium text-sm mb-1">Connection Failed</p>
                          <p className="text-red-700 text-sm">{connectionError}</p>
                        </div>
                      </div>
                    </div>
                    <Button 
                      onClick={() => {
                        setCurrentStep('anythingllm');
                        setConnectionError(null);
                        setPing("unknown");
                        setAuth("unknown");
                      }}
                      className="w-full"
                    >
                      Back to Configuration
                    </Button>
                  </div>
                )}
              </div>
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