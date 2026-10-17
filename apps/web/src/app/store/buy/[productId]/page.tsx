import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import SandboxCheckoutHelp from "@/components/sandbox-checkout-help";
import { formatMinor } from "@/lib/money";
import { fetchSellerPage } from "@/lib/server-api";

import CheckoutForm from "./checkout-form";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function BuyPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const page = await fetchSellerPage();
  const product = page?.products.find((candidate) => candidate.id === productId);
  if (!page || !product) notFound();

  return (
    <main className="container mx-auto max-w-xl space-y-8 px-4 py-10">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← {page.name}
      </Link>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Buy {product.title}</h1>
        {product.description ? <p className="whitespace-pre-line">{product.description}</p> : null}
        <p className="text-lg font-medium">{formatMinor(product.priceMinor, page.currency)}</p>
      </div>
      <CheckoutForm slug={page.slug} productId={product.id} currency={page.currency} />
      <SandboxCheckoutHelp />
    </main>
  );
}
