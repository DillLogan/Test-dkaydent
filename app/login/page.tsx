import { signIn, signOut, signUp } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, Notice } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const { error, message, mode, inactive } = await searchParams;
  const isSignup = mode === "signup";

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6">
          <div className="text-xs font-semibold tracking-widest text-brand-700 uppercase">DKaydent</div>
          <h1 className="text-xl font-semibold">Wholesale</h1>
          <p className="text-sm text-stone-500">{isSignup ? "Create an account" : "Sign in to continue"}</p>
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
            <span className="label">Email</span>
            <input name="email" type="email" className="input" required autoComplete="email" />
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

        <p className="mt-5 text-center text-sm text-stone-500">
          {isSignup ? (
            <a href="/login" className="link">
              Already have an account? Sign in
            </a>
          ) : (
            <a href="/login?mode=signup" className="link">
              New team member? Create an account
            </a>
          )}
        </p>
      </div>
    </div>
  );
}
