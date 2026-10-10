import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, ArrowRight, ArrowLeft, Shield, Mail, Sparkles, Lock, User } from "lucide-react";

const verifyCodeSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  token: z.string().min(4, "Access code must be at least 4 characters"),
});

const onboardingSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  occupation: z.string().optional(),
  tradingExperienceLevel: z.enum(["beginner", "intermediate", "advanced", "professional"]),
  knowledgeFocus: z.array(z.string()).min(1, "Select at least one area"),
  investmentGoals: z.enum(["income", "growth", "speculation", "hedging"]),
  riskTolerance: z.enum(["conservative", "moderate", "aggressive", "very_aggressive"]),
  referralSource: z.string().optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type VerifyCodeForm = z.infer<typeof verifyCodeSchema>;
type OnboardingForm = z.infer<typeof onboardingSchema>;

const KNOWLEDGE_AREAS = [
  { value: "stocks", label: "Stocks" },
  { value: "options", label: "Options" },
  { value: "futures", label: "Futures" },
  { value: "crypto", label: "Cryptocurrency" },
  { value: "forex", label: "Forex" },
  { value: "technical_analysis", label: "Technical Analysis" },
];

const EXPERIENCE_LEVELS = [
  { value: "beginner", label: "Beginner (0-1 years)" },
  { value: "intermediate", label: "Intermediate (1-3 years)" },
  { value: "advanced", label: "Advanced (3-7 years)" },
  { value: "professional", label: "Professional (7+ years)" },
];

const INVESTMENT_GOALS = [
  { value: "income", label: "Generate Income" },
  { value: "growth", label: "Long-term Growth" },
  { value: "speculation", label: "Short-term Speculation" },
  { value: "hedging", label: "Portfolio Hedging" },
];

const RISK_TOLERANCES = [
  { value: "conservative", label: "Conservative" },
  { value: "moderate", label: "Moderate" },
  { value: "aggressive", label: "Aggressive" },
  { value: "very_aggressive", label: "Very Aggressive" },
];

const inputStyles: React.CSSProperties = {
  backgroundColor: '#1a1a2e',
  border: '1px solid #374151',
  borderRadius: '8px',
  padding: '10px 12px',
  color: '#ffffff',
  fontSize: '14px',
  width: '100%',
  outline: 'none',
};

const inputWithIconStyles: React.CSSProperties = {
  ...inputStyles,
  paddingLeft: '40px',
};

export default function JoinBeta() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const [step, setStep] = useState<"verify" | "onboard" | "success">("verify");
  const [verifiedEmail, setVerifiedEmail] = useState("");

  const urlParams = new URLSearchParams(search);
  const initialCode = urlParams.get("code") || urlParams.get("invite") || "";

  const verifyForm = useForm<VerifyCodeForm>({
    resolver: zodResolver(verifyCodeSchema),
    defaultValues: { email: "", token: initialCode.trim() },
  });

  useEffect(() => {
    const params = new URLSearchParams(search);
    const code = params.get("code") || params.get("invite");
    if (code) {
      verifyForm.setValue("token", code.trim());
    }
  }, [search]);

  const onboardingForm = useForm<OnboardingForm>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      occupation: "",
      tradingExperienceLevel: "intermediate",
      knowledgeFocus: [],
      investmentGoals: "growth",
      riskTolerance: "moderate",
      referralSource: "",
      password: "",
      confirmPassword: "",
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (data: VerifyCodeForm) => {
      const response = await apiRequest("POST", "/api/beta/verify-code", {
        email: data.email.trim().toLowerCase(),
        token: data.token.trim().toLowerCase(),
      });
      return response.json();
    },
    onSuccess: (data) => {
      setVerifiedEmail(data.email);
      setStep("onboard");
      toast({
        title: "Code Verified",
        description: "Complete your profile to get started.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Verification Failed",
        description: error.message || "Invalid or expired access code",
        variant: "destructive",
      });
    },
  });

  const onboardMutation = useMutation({
    mutationFn: async (data: OnboardingForm) => {
      const response = await apiRequest("POST", "/api/beta/onboard", data);
      return response.json();
    },
    onSuccess: () => {
      setStep("success");
      toast({
        title: "Welcome!",
        description: "Your account is now active.",
      });
      setTimeout(() => navigate("/t"), 2000);
    },
    onError: (error: any) => {
      if (error.requiresVerification) {
        setStep("verify");
        toast({
          title: "Session Expired",
          description: "Please verify your code again.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Registration Failed",
          description: error.message || "Something went wrong",
          variant: "destructive",
        });
      }
    },
  });

  if (step === "success") {
    return (
      <div className="min-h-screen bg-[var(--surface-base)] flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none" />
        <div className="w-full max-w-md text-center relative z-10">
          <div className="mx-auto mb-6 w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <CheckCircle className="w-10 h-10 text-[var(--trade-bullish)]" />
          </div>
          <h1 className="text-2xl font-semibold text-white mb-2" data-testid="text-welcome-title">Welcome to the Lab!</h1>
          <p className="text-neutral-400 mb-6">Your account is active. Redirecting to dashboard...</p>
          <Button 
            onClick={() => navigate("/t")} 
            className="bg-sky-500 hover:bg-sky-400 text-black font-semibold rounded-xl shadow-lg"
            data-testid="button-go-automations"
          >
            Go to Dashboard
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--surface-base)] flex items-start justify-center py-8 px-6 relative overflow-y-auto">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-sky-500/5 blur-[120px] rounded-full pointer-events-none" />
      
      <div className="w-full max-w-lg relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center shadow-lg">
              <span className="text-lg font-bold text-white">Q</span>
            </div>
            <div>
              <span className="text-xl font-bold text-white tracking-tight">QUANT EDGE</span>
              <span className="text-neutral-600 mx-2">|</span>
              <span className="text-sm font-medium text-neutral-500 tracking-widest">LABS</span>
            </div>
          </div>
          <h1 className="text-xl font-semibold text-white mb-1" data-testid="text-join-beta-title">
            {step === "verify" ? "Verify Your Access" : "Complete Your Profile"}
          </h1>
          <p className="text-neutral-500 text-sm">
            {step === "verify" ? "Enter your email and access code to continue" : "Tell us about your trading experience"}
          </p>
        </div>

        <div className="flex justify-center items-center gap-3 mb-8">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold transition-all ${step === "verify" ? "bg-sky-500 text-black shadow-lg" : "bg-emerald-500/20 border border-emerald-500/30 text-[var(--trade-bullish)]"}`}>
            {step !== "verify" ? <CheckCircle className="w-5 h-5" /> : "1"}
          </div>
          <div className={`w-16 h-0.5 rounded-full transition-all ${step === "onboard" ? "bg-sky-500" : "bg-neutral-800"}`} />
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold transition-all ${step === "onboard" ? "bg-sky-500 text-black shadow-lg" : "bg-neutral-900 border border-neutral-800 text-neutral-600"}`}>
            2
          </div>
        </div>

        {step === "verify" ? (
          <div className="bg-card border border-neutral-800/80 rounded-2xl shadow-2xl shadow-black/50 relative overflow-hidden">
            <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-sky-500/30 to-transparent" />
            <CardHeader className="pb-4 pt-6">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-sky-400" />
                </div>
                <CardTitle className="text-white text-lg">Enter Your Details</CardTitle>
              </div>
              <CardDescription className="text-neutral-500">
                Use the email where you received your invite.
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-6">
              <form 
                onSubmit={verifyForm.handleSubmit((data) => verifyMutation.mutate(data))} 
                className="space-y-4"
                autoComplete="off"
              >
                <div>
                  <label className="block text-neutral-300 text-sm font-medium mb-2">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sky-500 z-10" />
                    <input
                      type="email"
                      placeholder="you@example.com"
                      data-testid="input-verify-email"
                      autoComplete="email"
                      style={inputWithIconStyles}
                      {...verifyForm.register("email")}
                    />
                  </div>
                  {verifyForm.formState.errors.email && (
                    <p className="text-[var(--trade-bearish)] text-sm mt-1">{verifyForm.formState.errors.email.message}</p>
                  )}
                </div>
                
                <div>
                  <label className="block text-neutral-300 text-sm font-medium mb-2">Access Code</label>
                  <div className="relative">
                    <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sky-500 z-10" />
                    <input
                      type="text"
                      placeholder="Enter your invite code"
                      data-testid="input-verify-token"
                      autoComplete="one-time-code"
                      style={{ ...inputWithIconStyles, fontFamily: 'monospace', color: '#3b8cff' }}
                      {...verifyForm.register("token")}
                    />
                  </div>
                  {verifyForm.formState.errors.token && (
                    <p className="text-[var(--trade-bearish)] text-sm mt-1">{verifyForm.formState.errors.token.message}</p>
                  )}
                </div>

                <Button 
                  type="submit" 
                  className="w-full h-12 bg-sky-500 hover:bg-sky-400 text-black font-semibold rounded-xl shadow-lg transition-all hover:shadow-lg mt-2"
                  disabled={verifyMutation.isPending}
                  data-testid="button-verify-code"
                >
                  {verifyMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <ArrowRight className="w-4 h-4 mr-2" />
                  )}
                  Verify & Continue
                </Button>
              </form>
            </CardContent>
          </div>
        ) : (
          <div className="bg-card border border-neutral-800/80 rounded-2xl shadow-2xl shadow-black/50 relative overflow-hidden">
            <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-sky-500/30 to-transparent" />
            <CardHeader className="pb-4 pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white text-lg">Your Profile</CardTitle>
                  <CardDescription className="text-sky-400">
                    {verifiedEmail}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep("verify")}
                  className="text-neutral-400 hover:text-white hover:bg-neutral-800"
                >
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pb-6">
              <Form {...onboardingForm}>
                <form onSubmit={onboardingForm.handleSubmit((data) => onboardMutation.mutate(data))} className="space-y-4">
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-neutral-300 text-sm font-medium mb-2">First Name</label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 z-10" />
                        <input
                          type="text"
                          data-testid="input-first-name"
                          autoComplete="given-name"
                          style={inputWithIconStyles}
                          {...onboardingForm.register("firstName")}
                        />
                      </div>
                      {onboardingForm.formState.errors.firstName && (
                        <p className="text-[var(--trade-bearish)] text-sm mt-1">{onboardingForm.formState.errors.firstName.message}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-neutral-300 text-sm font-medium mb-2">Last Name</label>
                      <input
                        type="text"
                        data-testid="input-last-name"
                        autoComplete="family-name"
                        style={inputStyles}
                        {...onboardingForm.register("lastName")}
                      />
                      {onboardingForm.formState.errors.lastName && (
                        <p className="text-[var(--trade-bearish)] text-sm mt-1">{onboardingForm.formState.errors.lastName.message}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-neutral-300 text-sm font-medium mb-2">Occupation (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Software Engineer"
                      data-testid="input-occupation"
                      autoComplete="off"
                      data-lpignore="true"
                      style={{ ...inputStyles, color: '#ffffff' }}
                      {...onboardingForm.register("occupation")}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={onboardingForm.control}
                      name="tradingExperienceLevel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-neutral-300">Experience</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="bg-[#1a1a2e] border-neutral-700 text-white focus:border-sky-500" data-testid="select-experience">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-[#1a1a2e] border-neutral-700">
                              {EXPERIENCE_LEVELS.map(level => (
                                <SelectItem key={level.value} value={level.value} className="text-white">{level.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={onboardingForm.control}
                      name="riskTolerance"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-neutral-300">Risk Tolerance</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="bg-[#1a1a2e] border-neutral-700 text-white focus:border-sky-500" data-testid="select-risk">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-[#1a1a2e] border-neutral-700">
                              {RISK_TOLERANCES.map(risk => (
                                <SelectItem key={risk.value} value={risk.value} className="text-white">{risk.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={onboardingForm.control}
                    name="investmentGoals"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-neutral-300">Investment Goal</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="bg-[#1a1a2e] border-neutral-700 text-white focus:border-sky-500" data-testid="select-goals">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="bg-[#1a1a2e] border-neutral-700">
                            {INVESTMENT_GOALS.map(goal => (
                              <SelectItem key={goal.value} value={goal.value} className="text-white">{goal.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={onboardingForm.control}
                    name="knowledgeFocus"
                    render={() => (
                      <FormItem>
                        <FormLabel className="text-neutral-300">Areas of Interest</FormLabel>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          {KNOWLEDGE_AREAS.map((area) => (
                            <FormField
                              key={area.value}
                              control={onboardingForm.control}
                              name="knowledgeFocus"
                              render={({ field }) => (
                                <FormItem className="flex items-center space-x-2 space-y-0 p-2 rounded-lg bg-[#1a1a2e]/50 border border-neutral-800/50 hover:border-neutral-700 transition-colors">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(area.value)}
                                      onCheckedChange={(checked) => {
                                        const updated = checked
                                          ? [...(field.value || []), area.value]
                                          : field.value?.filter((v: string) => v !== area.value) || [];
                                        field.onChange(updated);
                                      }}
                                      className="border-neutral-600 data-[state=checked]:bg-sky-500 data-[state=checked]:border-sky-500"
                                      data-testid={`checkbox-${area.value}`}
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm text-neutral-300 font-normal cursor-pointer">
                                    {area.label}
                                  </FormLabel>
                                </FormItem>
                              )}
                            />
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="pt-2 border-t border-neutral-800">
                    <div>
                      <label className="block text-neutral-300 text-sm font-medium mb-2">Password</label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 z-10" />
                        <input
                          type="password"
                          data-testid="input-password"
                          autoComplete="new-password"
                          style={inputWithIconStyles}
                          {...onboardingForm.register("password")}
                        />
                      </div>
                      {onboardingForm.formState.errors.password && (
                        <p className="text-[var(--trade-bearish)] text-sm mt-1">{onboardingForm.formState.errors.password.message}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-neutral-300 text-sm font-medium mb-2">Confirm Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 z-10" />
                      <input
                        type="password"
                        data-testid="input-confirm-password"
                        autoComplete="new-password"
                        style={inputWithIconStyles}
                        {...onboardingForm.register("confirmPassword")}
                      />
                    </div>
                    {onboardingForm.formState.errors.confirmPassword && (
                      <p className="text-[var(--trade-bearish)] text-sm mt-1">{onboardingForm.formState.errors.confirmPassword.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-neutral-300 text-sm font-medium mb-2">How did you find us? (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Twitter, Friend, Google"
                      data-testid="input-referral"
                      autoComplete="off"
                      style={inputStyles}
                      {...onboardingForm.register("referralSource")}
                    />
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full h-12 bg-sky-500 hover:bg-sky-400 text-black font-semibold rounded-xl shadow-lg transition-all hover:shadow-lg mt-2"
                    disabled={onboardMutation.isPending}
                    data-testid="button-complete-profile"
                  >
                    {onboardMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4 mr-2" />
                    )}
                    Complete Registration
                  </Button>
                </form>
              </Form>
            </CardContent>
          </div>
        )}

        <p className="text-center text-neutral-600 text-xs mt-6">
          By signing up, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
