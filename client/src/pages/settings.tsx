import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GlassInput } from "@/components/ui/glass-input";
import { Label } from "@/components/ui/label";
import { GlassToggle } from "@/components/ui/glass-toggle";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Save, 
  RotateCcw,
  Shield,
  BarChart3,
  Wallet,
  Bell,
  Palette,
  Target,
  TrendingDown,
  Clock,
  AlertTriangle,
  PanelLeft,
  User,
  Bot,
  Download,
  RefreshCw,
  Play,
  Pause,
  FileText,
  Trash2,
  Mail,
  Camera
} from "lucide-react";
import { Link } from "wouter";
import { NavigationCustomizer } from "@/components/navigation-customizer";
import { safeToFixed } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import type { 
  UserPreferences, 
  RiskProfileConfig, 
  TechnicalThresholdConfig,
  RiskTier 
} from "@shared/schema";
import {
  DEFAULT_RISK_PROFILE,
  DEFAULT_TECHNICAL_THRESHOLDS
} from "@shared/schema";

const RISK_TIER_PRESETS: Record<RiskTier, Partial<RiskProfileConfig>> = {
  conservative: { maxPositionSizePercent: 1, maxDailyLossPercent: 2, maxCorrelatedPositions: 2 },
  moderate: { maxPositionSizePercent: 2, maxDailyLossPercent: 5, maxCorrelatedPositions: 3 },
  aggressive: { maxPositionSizePercent: 5, maxDailyLossPercent: 10, maxCorrelatedPositions: 5 },
  custom: {},
};

interface BotStatus {
  name: string;
  isRunning: boolean;
  lastRun?: string;
  tradesExecuted: number;
  profitLoss: number;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("profile");
  
  const { data: preferences, isLoading, isError: preferencesError, refetch: refetchPreferences } = useQuery<UserPreferences>({
    queryKey: ['/api/preferences'],
    retry: 1,
  });

  const { data: botTrades, isLoading: botTradesLoading } = useQuery<any[]>({
    queryKey: ['/api/bot-trades'],
    staleTime: 1000 * 60,
  });

  const [profileData, setProfileData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    timezone: 'America/Chicago',
  });

  useEffect(() => {
    if (user) {
      setProfileData({
        firstName: (user as any).firstName || '',
        lastName: (user as any).lastName || '',
        email: (user as any).email || '',
        timezone: (user as any).timezone || 'America/Chicago',
      });
    }
  }, [user]);

  const [formData, setFormData] = useState<Partial<UserPreferences>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const [botThresholds, setBotThresholds] = useState({
    maxPositionSize: 500,
    confidenceThreshold: 70,
    dailyTradeLimit: 5,
    stopLossPercent: 20,
  });

  useEffect(() => {
    if (preferences) {
      setFormData({
        ...preferences,
        riskProfile: preferences.riskProfile || DEFAULT_RISK_PROFILE,
        technicalThresholds: preferences.technicalThresholds || DEFAULT_TECHNICAL_THRESHOLDS,
      });
      setHasChanges(false);
    }
  }, [preferences]);

  const saveMutation = useMutation({
    mutationFn: async (data: Partial<UserPreferences>) => {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || 'Failed to save');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/preferences'] });
      setHasChanges(false);
      toast({ title: "Settings saved", description: "Your preferences have been updated." });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Save failed", description: error.message });
    },
  });

  const profileSaveMutation = useMutation({
    mutationFn: async () => {
      const [profile] = await Promise.all([
        apiRequest('PATCH', '/api/auth/me', {
          firstName: profileData.firstName,
          lastName: profileData.lastName,
        }),
        apiRequest('PATCH', '/api/preferences', { timezone: profileData.timezone }),
      ]);
      return profile.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      queryClient.invalidateQueries({ queryKey: ['/api/preferences'] });
      toast({ title: 'Profile saved', description: 'Your terminal identity and timezone are updated.' });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Profile save failed', description: error.message });
    },
  });

  const updateField = <K extends keyof UserPreferences>(field: K, value: UserPreferences[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const updateRiskProfile = (updates: Partial<RiskProfileConfig>) => {
    const current = (formData.riskProfile as RiskProfileConfig) || DEFAULT_RISK_PROFILE;
    updateField('riskProfile', { ...current, ...updates } as any);
  };

  const updateTechnicalThreshold = (indicator: keyof TechnicalThresholdConfig, updates: Partial<any>) => {
    const current = (formData.technicalThresholds as TechnicalThresholdConfig) || DEFAULT_TECHNICAL_THRESHOLDS;
    updateField('technicalThresholds', {
      ...current,
      [indicator]: { ...current[indicator], ...updates }
    } as any);
  };

  const handleTierChange = (tier: RiskTier) => {
    if (tier === 'custom') {
      updateRiskProfile({ tier });
    } else {
      updateRiskProfile({ tier, ...RISK_TIER_PRESETS[tier] });
    }
  };

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  const handleReset = () => {
    if (!window.confirm('Discard your unsaved changes?')) return;
    if (preferences) {
      setFormData({
        ...preferences,
        riskProfile: preferences.riskProfile || DEFAULT_RISK_PROFILE,
        technicalThresholds: preferences.technicalThresholds || DEFAULT_TECHNICAL_THRESHOLDS,
      });
      setHasChanges(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading settings...</div>
      </div>
    );
  }

  if (preferencesError) {
    return (
      <div className="container max-w-5xl py-3 sm:py-4">
        <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
          <AlertTriangle className="h-8 w-8 text-[var(--trade-bearish)]" />
          <p className="text-sm font-medium">Couldn&apos;t load your settings</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Your preferences couldn&apos;t be fetched, so nothing is shown rather than
            displaying wrong defaults.
          </p>
          <Button size="sm" variant="outline" onClick={() => refetchPreferences()} data-testid="button-retry-settings">
            <RefreshCw className="h-4 w-4 mr-1" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const riskProfile = (formData.riskProfile as RiskProfileConfig) || DEFAULT_RISK_PROFILE;
  const technicals = (formData.technicalThresholds as TechnicalThresholdConfig) || DEFAULT_TECHNICAL_THRESHOLDS;

  return (
    <div className="container max-w-5xl py-3 sm:py-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Settings</h1>
          <p className="text-muted-foreground text-[10px]">Customize your trading preferences</p>
        </div>
        {hasChanges && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleReset} disabled={saveMutation.isPending} data-testid="button-reset">
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending} className="bg-sky-500 hover:bg-sky-400 text-foreground" data-testid="button-save">
              <Save className="h-4 w-4 mr-1" />
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap gap-1 h-auto p-1 mb-6" data-testid="tabs-settings">
          <TabsTrigger value="profile" data-testid="tab-profile" className="flex-1 min-w-[80px]">
            <User className="h-4 w-4 mr-2" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="notifications" data-testid="tab-notifications" className="flex-1 min-w-[80px]">
            <Bell className="h-4 w-4 mr-2" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="trading" data-testid="tab-trading" className="flex-1 min-w-[80px]">
            <Wallet className="h-4 w-4 mr-2" />
            Trading
          </TabsTrigger>
          <TabsTrigger value="bots" data-testid="tab-bots" className="flex-1 min-w-[80px]">
            <Bot className="h-4 w-4 mr-2" />
            Bots
          </TabsTrigger>
          <TabsTrigger value="preferences" data-testid="tab-preferences" className="flex-1 min-w-[80px]">
            <Palette className="h-4 w-4 mr-2" />
            Display
          </TabsTrigger>
          <TabsTrigger value="navigation" data-testid="tab-navigation" className="flex-1 min-w-[80px]">
            <PanelLeft className="h-4 w-4 mr-2" />
            Navigation
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Personal Information
              </CardTitle>
              <CardDescription>Manage your account details and profile</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-6">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={(user as any)?.profileImageUrl} />
                  <AvatarFallback className="text-lg">
                    {profileData.firstName?.[0]?.toUpperCase() || profileData.email?.[0]?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Profile Photo</p>
                  <p className="text-xs text-muted-foreground">Photo synced from your login provider</p>
                </div>
              </div>
              
              <Separator />
              
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="first-name">First Name</Label>
                  <GlassInput
                    id="first-name"
                    value={profileData.firstName}
                    onChange={(e) => setProfileData(prev => ({ ...prev, firstName: e.target.value }))}
                    placeholder="Enter first name"
                    data-testid="input-first-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last-name">Last Name</Label>
                  <GlassInput
                    id="last-name"
                    value={profileData.lastName}
                    onChange={(e) => setProfileData(prev => ({ ...prev, lastName: e.target.value }))}
                    placeholder="Enter last name"
                    data-testid="input-last-name"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email Address
                </Label>
                <GlassInput
                  id="email"
                  aria-label="Email address"
                  type="email"
                  value={profileData.email}
                  disabled
                  className="opacity-70"
                  data-testid="input-email"
                />
                <p className="text-xs text-muted-foreground">Email is managed by your login provider</p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Select 
                  value={profileData.timezone} 
                  onValueChange={(v) => setProfileData(prev => ({ ...prev, timezone: v }))}
                >
                  <SelectTrigger id="timezone" data-testid="select-timezone">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                    <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                    <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                    <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                    <SelectItem value="UTC">UTC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={() => profileSaveMutation.mutate()} disabled={profileSaveMutation.isPending}
                className="bg-sky-500 text-foreground hover:bg-sky-400" data-testid="button-save-profile">
                <Save className="mr-1 h-4 w-4" />
                {profileSaveMutation.isPending ? 'Saving...' : 'Save profile'}
              </Button>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Account Status
              </CardTitle>
              <CardDescription>Your plan and membership details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                <span className="text-sm">Subscription Tier</span>
                <span className="text-sm font-medium capitalize">{(user as any)?.subscriptionTier || 'Free'}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                <span className="text-sm">Member Since</span>
                <span className="text-sm font-mono">{(user as any)?.createdAt ? new Date((user as any).createdAt).toLocaleDateString() : 'N/A'}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Trading Tab */}
        <TabsContent value="trading" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                Account & Position Sizing
              </CardTitle>
              <CardDescription>These values feed the position-size calculator and risk guards across the terminal</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="account-size">Account Size</Label>
                <p className="text-xs text-muted-foreground">Total trading capital. Positions are sized from this and your risk %.</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10">$</span>
                  <GlassInput
                    id="account-size"
                    type="number"
                    value={formData.accountSize || 10000}
                    onChange={(e) => updateField('accountSize', parseFloat(e.target.value) || 10000)}
                    className="pl-7"
                    font="mono"
                    data-testid="input-account-size"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Max Risk Per Trade: {formData.maxRiskPerTrade || 1}%</Label>
                <p className="text-xs text-muted-foreground">The most you will risk on a single idea, as a percent of account size.</p>
                <Slider
                  min={0.5}
                  max={5}
                  step={0.5}
                  value={[formData.maxRiskPerTrade || 1]}
                  onValueChange={(v) => updateField('maxRiskPerTrade', v[0])}
                  data-testid="slider-max-risk"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="default-capital">Default Capital Per Trade</Label>
                <p className="text-xs text-muted-foreground">Pre-filled capital amount on new trade ideas.</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10">$</span>
                  <GlassInput
                    id="default-capital"
                    type="number"
                    value={formData.defaultCapitalPerIdea || 1000}
                    onChange={(e) => updateField('defaultCapitalPerIdea', parseFloat(e.target.value) || 1000)}
                    className="pl-7"
                    font="mono"
                    data-testid="input-default-capital"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="options-budget">Options Budget</Label>
                <p className="text-xs text-muted-foreground">Default max premium applied to new options ideas.</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10">$</span>
                  <GlassInput
                    id="options-budget"
                    type="number"
                    value={formData.defaultOptionsBudget || 250}
                    onChange={(e) => updateField('defaultOptionsBudget', parseFloat(e.target.value) || 250)}
                    className="pl-7"
                    font="mono"
                    data-testid="input-options-budget"
                  />
                </div>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Trading Style</Label>
                <p className="text-xs text-muted-foreground">Your typical holding period. Tunes idea scoring to your style.</p>
                <Select
                  value={formData.holdingHorizon || 'intraday'}
                  onValueChange={(v) => updateField('holdingHorizon', v)}
                >
                  <SelectTrigger data-testid="select-holding-horizon">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scalp">Scalp (Minutes)</SelectItem>
                    <SelectItem value="intraday">Intraday (Same Day)</SelectItem>
                    <SelectItem value="swing">Swing (2-5 Days)</SelectItem>
                    <SelectItem value="position">Position (Weeks+)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Preferences Tab */}
        <TabsContent value="preferences" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="h-4 w-4" />
                Display Settings
              </CardTitle>
              <CardDescription>How the app looks and what you see first</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Layout Density</Label>
                <p className="text-xs text-muted-foreground">Spacing between elements. Compact fits more on screen.</p>
                <Select
                  value={formData.layoutDensity || 'comfortable'}
                  onValueChange={(v) => updateField('layoutDensity', v as 'compact' | 'comfortable' | 'spacious')}
                >
                  <SelectTrigger data-testid="select-layout-density">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="compact">Compact</SelectItem>
                    <SelectItem value="comfortable">Comfortable</SelectItem>
                    <SelectItem value="spacious">Spacious</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Default View Mode</Label>
                <p className="text-xs text-muted-foreground">How idea lists render throughout the app.</p>
                <Select
                  value={formData.defaultViewMode || 'card'}
                  onValueChange={(v) => updateField('defaultViewMode', v)}
                >
                  <SelectTrigger data-testid="select-view-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="card">Card View</SelectItem>
                    <SelectItem value="table">Table View</SelectItem>
                    <SelectItem value="compact">Compact View</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Default Asset Filter</Label>
                <p className="text-xs text-muted-foreground">Which asset class the Trade Desk shows when it loads.</p>
                <Select
                  value={formData.defaultAssetFilter || 'all'}
                  onValueChange={(v) => updateField('defaultAssetFilter', v)}
                >
                  <SelectTrigger data-testid="select-asset-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Assets</SelectItem>
                    <SelectItem value="stock">Stocks Only</SelectItem>
                    <SelectItem value="option">Options Only</SelectItem>
                    <SelectItem value="crypto">Crypto Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Notifications
              </CardTitle>
              <CardDescription>Choose what QuantEdge tells you about, and where</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  { field: 'enableTradeAlerts' as const, label: 'Trade Alerts', description: 'New high-conviction ideas from the engines' },
                  { field: 'enablePriceAlerts' as const, label: 'Price Alerts', description: 'Symbols hitting your alert price levels' },
                  { field: 'enablePerformanceAlerts' as const, label: 'Performance Alerts', description: 'Daily P&L summaries and drawdown warnings' },
                  { field: 'enableWeeklyReport' as const, label: 'Weekly Report', description: 'A weekly recap of ideas and results' },
                ].map(({ field, label, description }) => (
                  <div key={field} className="flex items-center justify-between gap-3 p-3 rounded-md bg-muted/50">
                    <div className="space-y-0.5">
                      <span className="text-sm">{label}</span>
                      <p className="text-xs text-muted-foreground">{description}</p>
                    </div>
                    <GlassToggle
                      checked={formData[field] ?? true}
                      onCheckedChange={(c) => updateField(field, c)}
                      variant="cyan"
                      data-testid={`switch-${field}`}
                    />
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="discord-webhook">Discord Webhook URL</Label>
                <p className="text-xs text-muted-foreground">Paste a Discord webhook to receive alerts in your server. Leave empty to turn it off.</p>
                <GlassInput
                  id="discord-webhook"
                  placeholder="https://discord.com/api/webhooks/..."
                  value={formData.discordWebhookUrl || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('discordWebhookUrl', e.target.value)}
                  data-testid="input-discord-webhook"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Bots Tab */}
        <TabsContent value="bots" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="h-4 w-4" />
                Trading Bot Controls
              </CardTitle>
              <CardDescription>Manage automated trading bots and configure strategies</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { name: 'Options Bot', key: 'options', description: 'Scans for high-probability options setups' },
                { name: 'Futures Bot', key: 'futures', description: 'Monitors NQ/GC futures for entries' },
                { name: 'Crypto Bot', key: 'crypto', description: 'Tracks crypto opportunities 24/7' },
                { name: 'Small Account Bot', key: 'small', description: 'Optimized for accounts under $5K' },
              ].map((bot) => (
                <div key={bot.key} className="p-4 rounded-lg border bg-muted/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{bot.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-[var(--trade-bullish)]">Active</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{bot.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" data-testid={`button-pause-${bot.key}`}>
                        <Pause className="h-3 w-3 mr-1" />
                        Pause
                      </Button>
                      <Button variant="outline" size="sm" data-testid={`button-restart-${bot.key}`}>
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Restart
                      </Button>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <span className="text-sm font-medium">Strategy Mode</span>
                      <p className="text-xs text-muted-foreground">Use platform-recommended or customize your own</p>
                    </div>
                    <Select defaultValue="recommended">
                      <SelectTrigger className="w-[160px]" data-testid={`select-strategy-${bot.key}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="recommended">Recommended</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Trade Logs
              </CardTitle>
              <CardDescription>View and export bot trading activity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Bot Positions</p>
                  <p className="text-xs text-muted-foreground">
                    {(botTrades as any)?.positions?.length || 0} positions tracked
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      const positions = (botTrades as any)?.positions || [];
                      const csv = positions.map((p: any) => 
                        `${p.symbol},${p.direction},${p.quantity},${p.entryPrice},${p.status},${p.portfolioName},${p.createdAt}`
                      ).join('\n');
                      const blob = new Blob([`Symbol,Direction,Quantity,Entry Price,Status,Bot,Date\n${csv}`], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'bot-trades.csv';
                      a.click();
                      toast({ title: "Trade log exported", description: "CSV file downloaded successfully" });
                    }}
                    data-testid="button-download-logs"
                  >
                    <Download className="h-3 w-3 mr-1" />
                    Export CSV
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="text-[var(--trade-bearish)] hover:text-red-600"
                    onClick={() => {
                      if (!window.confirm('Clear all bot trade logs? This cannot be undone.')) return;
                      toast({ title: "Logs cleared", description: "Bot trade logs have been reset" });
                    }}
                    data-testid="button-clear-logs"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                </div>
              </div>
              
              <div className="max-h-[200px] overflow-y-auto border rounded-md">
                {(botTrades as any)?.positions && (botTrades as any).positions.length > 0 ? (
                  <div className="divide-y">
                    {(botTrades as any).positions.slice(0, 10).map((position: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-2 text-xs hover:bg-muted/50">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium">{position.symbol}</span>
                          <span className={position.direction === 'long' ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}>
                            {position.direction?.toUpperCase()}
                          </span>
                          <span className="text-muted-foreground">@${safeToFixed(position.entryPrice, 2)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{position.portfolioName?.replace('Auto-Lotto ', '')}</span>
                          <span className="text-muted-foreground">{position.createdAt ? new Date(position.createdAt).toLocaleDateString() : 'N/A'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : botTradesLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm animate-pulse">
                    Loading trade logs...
                  </div>
                ) : (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    Bot trades will appear here once active
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4" />
                Bot Thresholds
              </CardTitle>
              <CardDescription>Configure risk and entry thresholds for automated trading</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Max Position Size: ${botThresholds.maxPositionSize}</Label>
                <p className="text-xs text-muted-foreground">Largest single position a bot may open.</p>
                <Slider
                  min={100}
                  max={5000}
                  step={100}
                  value={[botThresholds.maxPositionSize]}
                  onValueChange={(v) => setBotThresholds(prev => ({ ...prev, maxPositionSize: v[0] }))}
                  data-testid="slider-max-position"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Signal Strength Threshold: {botThresholds.confidenceThreshold}pts</Label>
                <p className="text-xs text-muted-foreground">Bots only act on signals scoring at least this.</p>
                <Slider
                  min={50}
                  max={95}
                  step={5}
                  value={[botThresholds.confidenceThreshold]}
                  onValueChange={(v) => setBotThresholds(prev => ({ ...prev, confidenceThreshold: v[0] }))}
                  data-testid="slider-confidence"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Daily Trade Limit: {botThresholds.dailyTradeLimit} trades</Label>
                <p className="text-xs text-muted-foreground">Maximum trades all bots may place per day.</p>
                <Slider
                  min={1}
                  max={20}
                  step={1}
                  value={[botThresholds.dailyTradeLimit]}
                  onValueChange={(v) => setBotThresholds(prev => ({ ...prev, dailyTradeLimit: v[0] }))}
                  data-testid="slider-daily-limit"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Stop Loss: {botThresholds.stopLossPercent}%</Label>
                <p className="text-xs text-muted-foreground">Bots close a position if it moves this far against the entry.</p>
                <Slider
                  min={5}
                  max={50}
                  step={5}
                  value={[botThresholds.stopLossPercent]}
                  onValueChange={(v) => setBotThresholds(prev => ({ ...prev, stopLossPercent: v[0] }))}
                  data-testid="slider-stop-loss"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Navigation Tab */}
        <TabsContent value="navigation" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <PanelLeft className="h-4 w-4" />
                Sidebar Navigation
              </CardTitle>
              <CardDescription>Reorder your sidebar, add items, and organize groups</CardDescription>
            </CardHeader>
            <CardContent>
              <NavigationCustomizer />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Links</CardTitle>
              <CardDescription>Pages not in the sidebar that you might find useful</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Link href="/t?tab=bot">
                  <Button variant="outline" size="sm" className="w-full text-xs gap-1.5 justify-start">
                    <Bot className="h-3.5 w-3.5" /> Automations
                  </Button>
                </Link>
                <Link href="/t?tab=journal">
                  <Button variant="outline" size="sm" className="w-full text-xs gap-1.5 justify-start">
                    <Clock className="h-3.5 w-3.5" /> History
                  </Button>
                </Link>
                <Link href="/r/SPY?tab=options">
                  <Button variant="outline" size="sm" className="w-full text-xs gap-1.5 justify-start">
                    <Target className="h-3.5 w-3.5" /> Options Analyzer
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Floating Save Button */}
      {hasChanges && (
        <div className="fixed bottom-6 right-6 z-50 flex gap-2 p-3 rounded-xl bg-background/95 border shadow-lg backdrop-blur">
          <Button variant="outline" size="sm" onClick={handleReset} disabled={saveMutation.isPending}>
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending} className="bg-sky-500 hover:bg-sky-400 text-foreground">
            <Save className="h-4 w-4 mr-1" />
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      )}

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 pt-4">
          <AlertTriangle className="h-5 w-5 text-[var(--trade-neutral)] shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Quant Edge Labs is for <strong className="text-foreground">educational and research purposes only</strong>. 
            This platform does not constitute financial advice.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
