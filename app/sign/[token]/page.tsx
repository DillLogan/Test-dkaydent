import SignRecipient from "@/components/documents/SignRecipient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign document · DKaydent", robots: { index: false } };

// public; the API does the link/signer checks
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SignRecipient token={token} />;
}
