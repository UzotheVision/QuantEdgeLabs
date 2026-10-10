import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2 } from "lucide-react";

interface WaitlistPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WaitlistPopup({ open, onOpenChange }: WaitlistPopupProps) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const joinWaitlist = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", "/api/waitlist/join", { email, source: "popup" });
      return res.json();
    },
    onSuccess: (data) => {
      setSubmitted(true);
      toast({
        title: data.alreadyExists ? "You're already on the list!" : "Welcome to the Lab!",
        description: data.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Something went wrong",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      joinWaitlist.mutate(email.trim());
    }
  };

  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setEmail("");
        setSubmitted(false);
      }, 300);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Join the Lab</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Learn how trades are built, not copied.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-sky-500 mt-0.5 flex-shrink-0" />
              <span className="text-muted-foreground">Trade ideas explained, not hyped</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-sky-500 mt-0.5 flex-shrink-0" />
              <span className="text-muted-foreground">Beginner-first framework</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-sky-500 mt-0.5 flex-shrink-0" />
              <span className="text-muted-foreground">Real-time examples, real risk</span>
            </li>
          </ul>

          {submitted ? (
            <div className="bg-sky-500/10 border border-sky-500/20 rounded-lg p-4 text-center" data-testid="waitlist-success">
              <Check className="h-6 w-6 text-sky-500 mx-auto mb-2" />
              <p className="font-medium">You're on the list!</p>
              <p className="text-sm text-muted-foreground mt-1">We'll be in touch soon.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-waitlist-email"
              />
              <Button 
                type="submit" 
                className="w-full bg-sky-500 text-foreground hover:bg-sky-400 font-semibold"
                disabled={joinWaitlist.isPending}
                data-testid="button-join-waitlist"
              >
                {joinWaitlist.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Join the Waitlist"
                )}
              </Button>
            </form>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}
