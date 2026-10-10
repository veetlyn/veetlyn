"use client";

import { ALLOWED_FILE_EXTENSIONS, fileProblem, validateDigitalProductDraft } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import { parsePriceInput } from "@/lib/money";
import { uploadToPresignedUrl } from "@/lib/upload";
import { trpc, trpcClient } from "@/utils/trpc";

const PRICE_PROBLEM = "Enter the price as an amount, for example 150 or 19.99.";

const FILE_ACCEPT = ALLOWED_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(",");

type Fields = { title: string; description: string; price: string };

const EMPTY_FIELDS: Fields = { title: "", description: "", price: "" };

export default function DigitalProductForm({ teamSlug, productId }: { teamSlug: string; productId?: string }) {
  if (!productId) return <DetailsForm teamSlug={teamSlug} initial={EMPTY_FIELDS} />;
  return <EditDigitalProduct teamSlug={teamSlug} productId={productId} />;
}

function useInvalidateDigital(teamSlug: string, productId?: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      productId
        ? queryClient.invalidateQueries({ queryKey: trpc.catalog.digitalGet.queryKey({ storeSlug: teamSlug, id: productId }) })
        : null,
      queryClient.invalidateQueries({ queryKey: trpc.catalog.digitalList.queryKey({ storeSlug: teamSlug }) }),
      // The services dashboard checklist counts the team's digital products.
      queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) }),
    ]);
}

function EditDigitalProduct({ teamSlug, productId }: { teamSlug: string; productId: string }) {
  const detail = useQuery({ ...trpc.catalog.digitalGet.queryOptions({ storeSlug: teamSlug, id: productId }), retry: false });
  const invalidate = useInvalidateDigital(teamSlug, productId);
  const publish = useMutation(trpc.catalog.publish.mutationOptions({ onSuccess: invalidate }));
  const unpublish = useMutation(trpc.catalog.unpublish.mutationOptions({ onSuccess: invalidate }));

  if (detail.isPending) return <Loader />;
  if (detail.isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Product not found</h1>
        <Link href={`/${teamSlug}/products`} className="underline">
          Back to products
        </Link>
      </div>
    );
  }

  const product = detail.data;
  const published = product.status === "published";
  const statusMutation = published ? unpublish : publish;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div className="space-y-1">
          <Link href={`/${teamSlug}/products`} className="text-sm text-muted-foreground">
            Products
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{product.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{published ? "Published" : "Draft"}</span>
          <Button
            type="button"
            variant="outline"
            onClick={() => statusMutation.mutate({ storeSlug: teamSlug, id: productId })}
            disabled={statusMutation.isPending}
          >
            {published ? "Unpublish" : "Publish"}
          </Button>
        </div>
      </div>
      {statusMutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {statusMutation.error.message}
        </p>
      )}
      <DetailsForm
        teamSlug={teamSlug}
        productId={productId}
        initial={{ title: product.title, description: product.description, price: (product.priceMinor / 100).toFixed(2) }}
      />
      <FileSection teamSlug={teamSlug} productId={productId} fileName={product.fileName} />
    </div>
  );
}

function DetailsForm({ teamSlug, productId, initial }: { teamSlug: string; productId?: string; initial: Fields }) {
  const router = useRouter();
  const invalidate = useInvalidateDigital(teamSlug, productId);
  // Seeded once from the loaded product; a refetch after publishing must not overwrite unsaved edits.
  const [fields, setFields] = useState<Fields>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const create = useMutation(trpc.catalog.digitalCreate.mutationOptions());
  const update = useMutation(trpc.catalog.digitalUpdate.mutationOptions());
  const saving = create.isPending || update.isPending;

  const priceMinor = parsePriceInput(fields.price);
  const priceProblem = fields.price.trim() !== "" && priceMinor === null ? PRICE_PROBLEM : null;

  function patch(next: Partial<Fields>) {
    setFields((current) => ({ ...current, ...next }));
    setMessage(null);
    setSaved(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (priceMinor === null) {
      setMessage(PRICE_PROBLEM);
      return;
    }
    const draft = { title: fields.title.trim(), description: fields.description, priceMinor };
    const problems = validateDigitalProductDraft(draft);
    const [first] = problems;
    if (first) {
      setMessage(first.message);
      return;
    }
    const onError = (error: { message: string }) => setMessage(error.message);
    if (productId) {
      update.mutate(
        { storeSlug: teamSlug, id: productId, ...draft },
        {
          onSuccess: async () => {
            setSaved(true);
            await invalidate();
          },
          onError,
        },
      );
    } else {
      create.mutate(
        { storeSlug: teamSlug, ...draft },
        {
          onSuccess: (created) => {
            router.push(`/${teamSlug}/products/${created.id}`);
            void invalidate();
          },
          onError,
        },
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-1">
        <Label htmlFor="digital-title">Title</Label>
        <Input
          id="digital-title"
          value={fields.title}
          onChange={(event) => patch({ title: event.target.value })}
          maxLength={200}
          required
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="digital-description">Description</Label>
        <Textarea
          id="digital-description"
          value={fields.description}
          onChange={(event) => patch({ description: event.target.value })}
          rows={4}
        />
      </div>
      <div className="grid gap-1 sm:max-w-48">
        <Label htmlFor="digital-price">Price</Label>
        <Input
          id="digital-price"
          inputMode="decimal"
          value={fields.price}
          onChange={(event) => patch({ price: event.target.value })}
          aria-invalid={priceProblem !== null}
          aria-describedby={priceProblem ? "digital-price-problem" : undefined}
          required
        />
        {priceProblem && (
          <p id="digital-price-problem" className="text-sm text-destructive">
            {priceProblem}
          </p>
        )}
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      {saved && !message && (
        <p role="status" className="text-sm text-muted-foreground">
          Saved.
        </p>
      )}
      <div>
        <Button type="submit" disabled={saving || create.isSuccess || priceMinor === null}>
          {saving ? "Saving…" : productId ? "Save changes" : "Save product"}
        </Button>
      </div>
    </form>
  );
}

function FileSection({ teamSlug, productId, fileName }: { teamSlug: string; productId: string; fileName: string | null }) {
  const invalidate = useInvalidateDigital(teamSlug, productId);
  const [file, setFile] = useState<File | null>(null);
  // Remounting the file input clears it, so picking the same file again still fires onChange.
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const upload = useMutation({
    mutationFn: async (picked: File) => {
      setUploadProgress(0);
      try {
        const start = await trpcClient.catalog.fileUploadStart.mutate({
          storeSlug: teamSlug,
          productId,
          fileName: picked.name,
          sizeBytes: picked.size,
        });
        await uploadToPresignedUrl({ url: start.url, headers: start.headers, file: picked, onProgress: setUploadProgress });
        return await trpcClient.catalog.fileAttach.mutate({ storeSlug: teamSlug, productId, uploadId: start.uploadId });
      } finally {
        setUploadProgress(null);
      }
    },
    onSuccess: () => {
      setFile(null);
      setFileInputKey((key) => key + 1);
      return invalidate();
    },
  });

  const pickedProblem = file ? fileProblem({ name: file.name, sizeBytes: file.size }) : null;
  const problem = pickedProblem ?? upload.error?.message ?? null;

  return (
    <section className="grid gap-2 border p-4">
      <h2 className="font-medium">File buyers download</h2>
      {fileName ? <p className="text-sm">{fileName}</p> : <p className="text-sm text-muted-foreground">No file yet.</p>}
      <Label htmlFor="digital-file" className="sr-only">
        {fileName ? "Replace the file" : "Choose a file"}
      </Label>
      <input
        key={fileInputKey}
        id="digital-file"
        type="file"
        accept={FILE_ACCEPT}
        className="text-sm"
        disabled={upload.isPending}
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          upload.reset();
        }}
      />
      <p className="text-sm text-muted-foreground">Files can be up to 100 MB.</p>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => file && upload.mutate(file)}
          disabled={!file || pickedProblem !== null || upload.isPending}
        >
          {uploadProgress === null ? "Upload" : `Uploading… ${Math.round(uploadProgress * 100)}%`}
        </Button>
      </div>
    </section>
  );
}
