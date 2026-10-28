import { signIn, signOut, signUp } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, Notice } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const { error, message, mode, inactive } = await searchParams;
  const isSignup = mode === "signup";

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card page-in w-full max-w-sm p-8">
        <div className="mb-6">
          <h1 className="text-4xl leading-none text-stone-900">DKaydent</h1>
          <div className="mt-1 text-brand-700">Wholesale flowers &amp; goods</div>
          <p className="mt-4 text-[15px] text-stone-500">{isSignup ? "Create an account" : "Sign in to continue"}</p>
        </div>

        {inactive && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Your account is waiting for an admin to activate it and assign a role.
            <form action={signOut} className="mt-2">
              <button className="text-xs font-medium underline">Sign out</button>
            </form>
          </div>
        )}
        <ErrorBanner error={error} />
        <Notice message={message} />

        <form action={isSignup ? signUp : signIn} className="space-y-4">
          {isSignup && (
            <label className="block">
              <span className="label">Full name</span>
              <input name="full_name" className="input" required autoComplete="name" />
            </label>
          )}
          <label className="block">
            <span className="label">{isSignup ? "Email" : "Username or email"}</span>
            <input name="email" type={isSignup ? "email" : "text"} className="input" required autoComplete="username" autoCapitalize="none" spellCheck={false} />
          </label>
          <label className="block">
            <span className="label">Password</span>
            <input
              name="password"
              type="password"
              className="input"
              required
              minLength={8}
              autoComplete={isSignup ? "new-password" : "current-password"}
            />
          </label>
          <SubmitButton className="btn btn-primary w-full" pendingText={isSignup ? "Creating…" : "Signing in…"}>
            {isSignup ? "Create account" : "Sign in"}
          </SubmitButton>
        </form>

        {isSignup && (
          <p className="mt-5 text-center text-sm text-stone-500">
            <a href="/login" className="link">
              Already have an account? Sign in
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
