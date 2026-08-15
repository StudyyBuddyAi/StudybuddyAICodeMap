import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AuthModal = ({ open, onOpenChange }: AuthModalProps) => {
  const { signIn, startSignUp, confirmSignUp, resendSignUpOtp, resetPasswordForEmail } = useAuth();
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
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState("");
  const [signUpStep, setSignUpStep] = useState<"form" | "otp">("form");
  const [signUpOtpType, setSignUpOtpType] = useState<"email_change" | "signup" | null>(null);
  const [signUpOtpValue, setSignUpOtpValue] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  // The typed password lives here from the form step through the OTP step, then
  // goes straight to confirmSignUp. In memory only — never persisted anywhere.
  const resetSignUpState = () => {
    setSignUpEmail("");
    setSignUpPassword("");
    setSignUpConfirmPassword("");
    setSignUpError(null);
    setSignUpLoading(false);
    setSignUpStep("form");
    setSignUpOtpType(null);
    setSignUpOtpValue("");
    setResendCooldown(0);
  };

  useEffect(() => {
    if (!open) {
      setShowForgotPassword(false);
      setForgotEmail("");
      setForgotError(null);
      setForgotLoading(false);
      setForgotSent(false);
      resetSignUpState();
    }
  }, [open]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
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

    if (signUpPassword !== signUpConfirmPassword) {
      setSignUpError("Passwords don't match");
      return;
    }

    setSignUpLoading(true);
    const { error, otpType } = await startSignUp(signUpEmail, signUpPassword);
    setSignUpLoading(false);

    if (error) {
      setSignUpError(error);
      return;
    }

    setSignUpOtpType(otpType);
    setSignUpStep("otp");
    setResendCooldown(60);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUpOtpType) return;
    setSignUpError(null);
    setSignUpLoading(true);
    const { error } = await confirmSignUp(signUpEmail, signUpOtpValue, signUpPassword, signUpOtpType);
    setSignUpLoading(false);

    if (error) {
      setSignUpError(error);
      setSignUpOtpValue("");
      return;
    }

    toast({ title: "Email verified — welcome to StudyBuddy!" });
    resetSignUpState();
    onOpenChange(false);
  };

  const handleResendOtp = async () => {
    if (!signUpOtpType || resendCooldown > 0) return;
    const { error } = await resendSignUpOtp(signUpEmail, signUpOtpType);
    if (error) {
      setSignUpError(error);
      return;
    }
    setResendCooldown(60);
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
            {signUpStep === "form" ? (
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
                <div className="space-y-2">
                  <Label htmlFor="signup-confirm-password">Confirm password</Label>
                  <Input
                    id="signup-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={signUpConfirmPassword}
                    onChange={(e) => setSignUpConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                  {signUpConfirmPassword.length > 0 && signUpPassword !== signUpConfirmPassword && (
                    <p className="text-sm text-destructive">Passwords don't match</p>
                  )}
                </div>
                {signUpError && (
                  <p className="text-sm text-destructive">{signUpError}</p>
                )}
                <Button
                  type="submit"
                  className="w-full h-10 rounded-lg font-medium"
                  disabled={signUpLoading}
                >
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
            ) : (
              <div className="space-y-4 pt-2">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setSignUpStep("form");
                      setSignUpOtpValue("");
                      setSignUpError(null);
                    }}
                    aria-label="Back to sign up form"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <h3 className="text-base font-semibold tracking-tight">Check your email</h3>
                </div>

                <p className="text-sm text-muted-foreground">
                  We sent a 6-digit code to <span className="font-medium text-foreground">{signUpEmail}</span>
                </p>

                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div className="flex justify-center">
                    <InputOTP
                      maxLength={6}
                      value={signUpOtpValue}
                      onChange={setSignUpOtpValue}
                      autoFocus
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} className="h-12 w-11 text-base" />
                        <InputOTPSlot index={1} className="h-12 w-11 text-base" />
                        <InputOTPSlot index={2} className="h-12 w-11 text-base" />
                        <InputOTPSlot index={3} className="h-12 w-11 text-base" />
                        <InputOTPSlot index={4} className="h-12 w-11 text-base" />
                        <InputOTPSlot index={5} className="h-12 w-11 text-base" />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>

                  {signUpError && (
                    <p className="text-sm text-destructive text-center">{signUpError}</p>
                  )}

                  <Button
                    type="submit"
                    className="w-full h-10 rounded-lg font-medium"
                    disabled={signUpLoading || signUpOtpValue.length < 6}
                  >
                    {signUpLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying…
                      </>
                    ) : (
                      "Verify email"
                    )}
                  </Button>
                </form>

                <div className="text-center">
                  {resendCooldown > 0 ? (
                    <span className="text-sm text-muted-foreground">
                      Resend code ({resendCooldown}s)
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 text-sm text-primary hover:bg-transparent hover:text-primary/80"
                      onClick={handleResendOtp}
                    >
                      Resend code
                    </Button>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default AuthModal;
