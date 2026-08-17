import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AuthModal = ({ open, onOpenChange }: AuthModalProps) => {
  const { signIn, signUp, resetPasswordForEmail, verifyOtp, resendSignUpOtp, isAnonymous } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<"signin" | "signup">("signin");

  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signInLoading, setSignInLoading] = useState(false);

  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpError, setSignUpError] = useState<string | null>(null);
  const [signUpLoading, setSignUpLoading] = useState(false);

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  // Email verification state
  const [pendingVerification, setPendingVerification] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpType, setOtpType] = useState<"signup" | "email_change">("signup");

  useEffect(() => {
    if (!open) {
      setShowForgotPassword(false);
      setForgotEmail("");
      setForgotError(null);
      setForgotLoading(false);
      setForgotSent(false);
      // Reset verification state on close
      setPendingVerification(false);
      setPendingEmail("");
      setOtpCode("");
      setOtpError(null);
      setOtpLoading(false);
      setResendCooldown(0);
    }
  }, [open]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setInterval(() => {
        setResendCooldown((prev) => Math.max(0, prev - 1));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [resendCooldown]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignInError(null);
    setSignInLoading(true);
    const { error } = await signIn(signInEmail, signInPassword);
    setSignInLoading(false);
    if (error) {
      setSignInError(error);
      return;
    }
    toast({ title: "Signed in" });
    setSignInEmail("");
    setSignInPassword("");
    onOpenChange(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    setForgotLoading(true);
    const { error } = await resetPasswordForEmail(forgotEmail);
    setForgotLoading(false);
    if (error) {
      setForgotError(error);
      return;
    }
    setForgotSent(true);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignUpError(null);
    setSignUpLoading(true);
    const { error, needsVerification, email } = await signUp(signUpEmail, signUpPassword);
    setSignUpLoading(false);
    if (error) {
      setSignUpError(error);
      return;
    }
    if (needsVerification) {
      setPendingVerification(true);
      setPendingEmail(email ?? signUpEmail);
      setOtpType(isAnonymous ? "email_change" : "signup");
      setSignUpEmail("");
      setSignUpPassword("");
    } else {
      toast({ title: "Account created" });
      setSignUpEmail("");
      setSignUpPassword("");
      onOpenChange(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setOtpError(null);
    if (otpCode.length !== 6) {
      setOtpError("Please enter the 6-digit code");
      return;
    }
    setOtpLoading(true);
    const { error } = await verifyOtp(pendingEmail, otpCode, otpType);
    setOtpLoading(false);
    if (error) {
      setOtpError(error);
      return;
    }
    toast({ title: "Email verified successfully" });
    setPendingVerification(false);
    setPendingEmail("");
    setOtpCode("");
    onOpenChange(false);
  };

  const handleResendOtp = async () => {
    setOtpError(null);
    const { error } = await resendSignUpOtp(pendingEmail, otpType);
    if (error) {
      setOtpError(error);
      return;
    }
    setResendCooldown(60);
    toast({ title: "Code resent" });
  };

  const goBackFromVerification = () => {
    setPendingVerification(false);
    setPendingEmail("");
    setOtpCode("");
    setOtpError(null);
    setResendCooldown(0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">Welcome</DialogTitle>
          <DialogDescription>
            Sign in or create an account to get started.
          </DialogDescription>
        </DialogHeader>

        {pendingVerification ? (
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={goBackFromVerification}
                aria-label="Back to sign up"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h3 className="text-base font-semibold tracking-tight">Verify your email</h3>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4 shrink-0" />
              <p>We sent a 6-digit code to <span className="font-medium">{pendingEmail}</span></p>
            </div>

            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp-code">Verification code</Label>
                <Input
                  id="otp-code"
                  type="text"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="text-center text-2xl tracking-widest font-mono"
                  required
                  disabled={otpLoading}
                />
              </div>

              {otpError && <p className="text-sm text-destructive">{otpError}</p>}

              <Button type="submit" className="w-full h-10 rounded-lg font-medium" disabled={otpLoading}>
                {otpLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  "Verify"
                )}
              </Button>
            </form>

            <div className="space-y-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                className="w-full text-sm"
                onClick={handleResendOtp}
                disabled={resendCooldown > 0}
              >
                {resendCooldown > 0 ? (
                  <>Resend code in {resendCooldown}s</>
                ) : (
                  "Resend code"
                )}
              </Button>
            </div>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              {!showForgotPassword ? (
                <form onSubmit={handleSignIn} className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      autoComplete="email"
                      value={signInEmail}
                      onChange={(e) => setSignInEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <Input
                      id="signin-password"
                      type="password"
                      autoComplete="current-password"
                      value={signInPassword}
                      onChange={(e) => setSignInPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex justify-end -mt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent"
                      onClick={() => setShowForgotPassword(true)}
                    >
                      Forgot password?
                    </Button>
                  </div>
                  {signInError && (
                    <p className="text-sm text-destructive">{signInError}</p>
                  )}
                  <Button type="submit" className="w-full h-10 rounded-lg font-medium" disabled={signInLoading}>
                    {signInLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in…
                      </>
                    ) : (
                      "Sign In"
                    )}
                  </Button>
                </form>
              ) : (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setShowForgotPassword(false);
                        setForgotEmail("");
                        setForgotError(null);
                        setForgotSent(false);
                      }}
                      aria-label="Back to sign in"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h3 className="text-base font-semibold tracking-tight">Reset your password</h3>
                  </div>

                  {forgotSent ? (
                    <p className="text-sm text-muted-foreground">
                      Check your email for a reset link.
                    </p>
                  ) : (
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="forgot-email">Email</Label>
                        <Input
                          id="forgot-email"
                          type="email"
                          autoComplete="email"
                          value={forgotEmail}
                          onChange={(e) => setForgotEmail(e.target.value)}
                          required
                        />
                      </div>
                      {forgotError && (
                        <p className="text-sm text-destructive">{forgotError}</p>
                      )}
                      <Button type="submit" className="w-full h-10 rounded-lg font-medium" disabled={forgotLoading}>
                        {forgotLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Sending…
                          </>
                        ) : (
                          "Send reset link"
                        )}
                      </Button>
                    </form>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    value={signUpEmail}
                    onChange={(e) => setSignUpEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    autoComplete="new-password"
                    value={signUpPassword}
                    onChange={(e) => setSignUpPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                {signUpError && (
                  <p className="text-sm text-destructive">{signUpError}</p>
                )}
                <Button type="submit" className="w-full h-10 rounded-lg font-medium" disabled={signUpLoading}>
                  {signUpLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating account…
                    </>
                  ) : (
                    "Sign Up"
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AuthModal;
