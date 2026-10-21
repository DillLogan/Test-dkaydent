import { requireRole } from "@/lib/auth";
import { createProduct } from "../actions";
import { ProductFields } from "@/components/ProductFields";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorBanner, PageHeader } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function NewProductPage({ searchParams }: { searchParams: SP }) {
  const { error } = await searchParams;
  await requireRole("buyer");
  return (
    <>
      <PageHeader title="New product" back={{ href: "/products", label: "Products" }} />
      <ErrorBanner error={error} />
      <form action={createProduct} className="card space-y-4">
        <ProductFields product={null} isNew />
        <p className="text-xs text-stone-500">
          Stock is always counted in the base unit. Add more pack units (bunch, box, case) on the next screen.
        </p>
        <SubmitButton>Create product</SubmitButton>
      </form>
    </>
  );
}
