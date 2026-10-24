import { cleanUsername, USERNAME_MAX } from "@/lib/display-name";
import { friendlyAuthError, passwordRequirementError, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth-errors";
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
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Loader2, Mail, MailCheck } from "lucide-react";
import GoogleIcon from "@/components/icons/GoogleIcon";
import BrandMark from "@/components/brand/BrandMark";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs once the student is signed in (or verified), e.g. to continue where they were headed. */
  onSignedIn?: () => void;
  /** One line above the form saying why sign-in is needed here. */
  reason?: string;
}

/** Seconds before a new code can be requested. */
const RESEND_COOLDOWN_S = 60;

const AuthModal = ({ open, onOpenChange, onSignedIn, reason }: AuthModalProps) => {
  const { signIn, signUp, signInWithGoogle, resetPasswordForEmail, verifyOtp, resendSignUpOtp, isAnonymous } =
    useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<"signin" | "signup">("signin");

  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signInLoading, setSignInLoading] = useState(false);

  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpUsername, setSignUpUsername] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpConfirm, setSignUpConfirm] = useState("");
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
      setGoogleLoading(false);
      setGoogleError(null);
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

  const handleGoogle = async () => {
    setGoogleError(null);
    setGoogleLoading(true);
    const { error } = await signInWithGoogle();
    if (error) {
      setGoogleLoading(false);
      setGoogleError(friendlyAuthError(error));
      return;
    }
    // On success the browser is navigating to Google; leave the spinner up
    // so the button can't be double-clicked before the page unloads.
  };

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
    onSignedIn?.();
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
    toast({ title: "Reset link sent", description: `Check ${forgotEmail} — and your spam folder.` });
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignUpError(null);
    // The field already says so under itself; send focus there instead of
    // repeating the same error a second time under the form.
    if (signUpPassword !== signUpConfirm) {
      document.getElementById("signup-confirm")?.focus();
      return;
    }
    const passwordProblem = passwordRequirementError(signUpPassword);
    if (passwordProblem) {
      setSignUpError(passwordProblem);
      return;
    }
    setSignUpLoading(true);
    const { error, needsVerification, email } = await signUp(
      signUpEmail,
      signUpPassword,
      cleanUsername(signUpUsername)
    );
    setSignUpLoading(false);
    if (error) {
      setSignUpError(error);
      return;
    }
    if (needsVerification) {
      setPendingVerification(true);
      setPendingEmail(email ?? signUpEmail);
      // A code was just sent: the next one can be asked for after the cooldown.
      setResendCooldown(RESEND_COOLDOWN_S);
      setOtpType(isAnonymous ? "email_change" : "signup");
      // The typed password lives here from the form step through the OTP step,
      // where verifyOtp applies it once the user is no longer anonymous. In
      // memory only — never persisted anywhere. Cleared in handleVerifyOtp.
    } else {
      toast({ title: "Account created" });
      setSignUpEmail("");
      setSignUpPassword("");
      setSignUpConfirm("");
      onOpenChange(false);
      onSignedIn?.();
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
    const { error } = await verifyOtp(pendingEmail, otpCode, signUpPassword, otpType);
    setOtpLoading(false);
    if (error) {
      setOtpError(error);
      return;
    }
    toast({ title: "Email verified successfully" });
    setPendingVerification(false);
    setPendingEmail("");
    setOtpCode("");
    setSignUpEmail("");
    setSignUpPassword("");
    setSignUpConfirm("");
    onOpenChange(false);
    onSignedIn?.();
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;
    setOtpError(null);
    // Start the cooldown before the request, so a second click can't send twice.
    setResendCooldown(RESEND_COOLDOWN_S);
    const { error } = await resendSignUpOtp(pendingEmail, otpType);
    if (error) {
      setOtpError(error);
      setResendCooldown(0);
      return;
    }
    toast({ title: "A new code is on its way", description: `Sent to ${pendingEmail}. Check your spam folder too.` });
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
        <DialogHeader className="items-center text-center sm:text-center">
          <BrandMark size={44} className="mx-auto mb-1" />
          <DialogTitle className="text-lg font-semibold tracking-tight">
            {showForgotPassword ? (forgotSent ? "Check your inbox" : "Reset your password") : "Welcome"}
          </DialogTitle>
          <DialogDescription>
            {showForgotPassword
              ? forgotSent
                ? "We've sent you a link to choose a new password."
                : "Enter your account email and we'll send you a link to choose a new password."
              : reason ?? "Sign in or create an account to get started."}
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
              <p>
                We sent a 6-digit code to <span className="font-medium">{pendingEmail}</span>. Enter it below to
                confirm this email is yours.
              </p>
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
        ) : showForgotPassword ? (
          <ForgotPasswordView
            email={forgotEmail}
            onEmailChange={(v) => {
              setForgotEmail(v);
              setForgotError(null);
            }}
            error={forgotError}
            loading={forgotLoading}
            sent={forgotSent}
            onSubmit={handleForgotPassword}
            onResend={() => setForgotSent(false)}
            onBack={() => {
              setShowForgotPassword(false);
              setForgotError(null);
              setForgotSent(false);
              setTab("signin");
            }}
          />
        ) : (
          <div className="space-y-4 pt-2">
            <Button
              type="button"
              variant="outline"
              className="w-full h-10 rounded-lg font-medium"
              onClick={handleGoogle}
              disabled={googleLoading}
            >
              {googleLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <GoogleIcon className="mr-2 h-4 w-4" />
              )}
              Continue with Google
            </Button>
            {googleError && <p className="text-sm text-destructive">{googleError}</p>}

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
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
                    <Label htmlFor="signup-username">
                      Username <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="signup-username"
                      type="text"
                      autoComplete="nickname"
                      value={signUpUsername}
                      onChange={(e) => setSignUpUsername(e.target.value)}
                      maxLength={USERNAME_MAX}
                      placeholder="Taken from your email if left empty"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      autoComplete="new-password"
                      value={signUpPassword}
                      onChange={(e) => {
                        setSignUpPassword(e.target.value);
                        if (signUpError) setSignUpError(null);
                      }}
                      aria-describedby="signup-password-hint"
                      required
                      minLength={PASSWORD_MIN}
                      maxLength={PASSWORD_MAX}
                    />
                    <p id="signup-password-hint" className="text-xs text-muted-foreground">
                      At least {PASSWORD_MIN} characters.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm">Confirm password</Label>
                    <Input
                      id="signup-confirm"
                      type="password"
                      autoComplete="new-password"
                      value={signUpConfirm}
                      onChange={(e) => {
                        setSignUpConfirm(e.target.value);
                        if (signUpError) setSignUpError(null);
                      }}
                      aria-invalid={signUpConfirm.length > 0 && signUpConfirm !== signUpPassword ? true : undefined}
                      required
                      minLength={6}
                    />
                    {signUpConfirm.length > 0 && signUpConfirm !== signUpPassword && (
                      <p className="text-xs text-destructive">The passwords don't match yet.</p>
                    )}
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

/** Its own screen: no Google button or tabs around it, so it reads as one task. */
function ForgotPasswordView({
  email,
  onEmailChange,
  error,
  loading,
  sent,
  onSubmit,
  onResend,
  onBack,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  error: string | null;
  loading: boolean;
  sent: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onResend: () => void;
  onBack: () => void;
}) {
  if (sent) {
    return (
      <div className="space-y-4 pt-2 text-center" role="status">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">
          <MailCheck className="h-7 w-7" aria-hidden />
        </span>
        <p className="text-sm text-foreground">
          We sent a reset link to <span className="font-semibold">{email}</span>.
        </p>
        <p className="text-sm text-muted-foreground">
          Open it on this device to choose a new password. It can take a minute to arrive — check your spam
          folder too.
        </p>
        <Button type="button" className="w-full h-10 rounded-lg font-medium" onClick={onBack}>
          Back to sign in
        </Button>
        <button
          type="button"
          onClick={onResend}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Didn't get it? Send it again
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pt-2">
      <div className="space-y-2">
        <Label htmlFor="forgot-email">Email</Label>
        <Input
          id="forgot-email"
          type="email"
          autoComplete="email"
          placeholder="you@university.edu"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          required
          autoFocus
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full h-10 rounded-lg font-medium" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Sending…
          </>
        ) : (
          "Send reset link"
        )}
      </Button>
      <p className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Remember your password?
        <button type="button" onClick={onBack} className="font-semibold text-foreground hover:underline">
          Sign in
        </button>
      </p>
    </form>
  );
}

export default AuthModal;
