import { requestReset } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function ForgotPage({ searchParams }: { searchParams: SP }) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card page-in w-full max-w-sm p-8">
        <h1 className="text-3xl leading-none text-stone-900">Reset password</h1>
        <p className="mt-3 text-[15px] text-stone-500">
          Enter your username. If we have your email we&apos;ll send a link. Otherwise your sales rep gets a request to approve, and then you can
          choose a new password.
        </p>
        <div className="mt-4">
          <ErrorBanner error={error} />
        </div>
        <form action={requestReset} className="mt-4 space-y-4">
          <label className="block">
            <span className="label">Username</span>
            <input name="username" className="input" required autoCapitalize="none" spellCheck={false} autoComplete="username" />
          </label>
          <SubmitButton className="btn btn-primary w-full" pendingText="Sending…">
            Send reset
          </SubmitButton>
        </form>
        <p className="mt-5 text-center text-sm text-stone-500">
          <a href="/login/reset" className="link">
            My reset was approved
          </a>
          {" · "}
          <a href="/login" className="link">
            Back to sign in
          </a>
        </p>
      </div>
    </div>
  );
}
