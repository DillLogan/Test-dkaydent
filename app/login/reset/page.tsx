import { resetApproved, resetWithToken } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function ResetPage({ searchParams }: { searchParams: SP }) {
  const { error, token_hash } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card page-in w-full max-w-sm p-8">
        <h1 className="text-3xl leading-none text-stone-900">Choose a new password</h1>
        <p className="mt-3 text-[15px] text-stone-500">
          {token_hash ? "Enter the password you want to use." : "Use this once your sales rep has approved your reset request."}
        </p>
        <div className="mt-4">
          <ErrorBanner error={error} />
        </div>
        <form action={token_hash ? resetWithToken : resetApproved} className="mt-4 space-y-4">
          {token_hash ? (
            <input type="hidden" name="token_hash" value={token_hash} />
          ) : (
            <label className="block">
              <span className="label">Username</span>
              <input name="username" className="input" required autoCapitalize="none" spellCheck={false} autoComplete="username" />
            </label>
          )}
          <label className="block">
            <span className="label">New password</span>
            <input name="next" type="password" className="input" required minLength={8} autoComplete="new-password" />
          </label>
          <label className="block">
            <span className="label">Type it again</span>
            <input name="again" type="password" className="input" required minLength={8} autoComplete="new-password" />
          </label>
          <SubmitButton className="btn btn-primary w-full" pendingText="Saving…">
            Save password
          </SubmitButton>
        </form>
        <p className="mt-5 text-center text-sm text-stone-500">
          <a href="/login" className="link">
            Back to sign in
          </a>
        </p>
      </div>
    </div>
  );
}
