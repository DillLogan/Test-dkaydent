import SignRecipient from "@/components/documents/SignRecipient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign document · DKaydent", robots: { index: false } };

/** Public signing page. The API behind it checks the link and the signer (account sign-in, or the email it was sent to). */
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SignRecipient token={token} />;
}
