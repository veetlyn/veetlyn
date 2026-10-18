"use client";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import { canStartProject, type ServicesTeamRole } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { type FormEvent, useState } from "react";

import { ClientProjectView } from "@/components/client-project-view";
import Loader from "@/components/loader";
import { trpc, trpcClient } from "@/utils/trpc";

type Contact = inferRouterOutputs<AppRouter>["project"]["get"]["contacts"][number];

// Who the project's clients are (design §5.7). The team never sees a client link: it emails it, reissues it,
// or previews the client page read-only.
export function ClientsSection({
  teamSlug,
  projectId,
  contacts,
  role,
  onChange,
}: {
  teamSlug: string;
  projectId: string;
  contacts: Contact[];
  role: ServicesTeamRole;
  onChange: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const manages = canStartProject(role);

  const add = useMutation(
    trpc.project.clientAdd.mutationOptions({
      onSuccess: () => {
        setEmail("");
        setName("");
        setNotice(null);
        return onChange();
      },
    }),
  );
  const remove = useMutation(trpc.project.clientRemove.mutationOptions({ onSuccess: () => onChange() }));
  const sendLink = useMutation(
    trpc.project.clientLinkEmail.mutationOptions({ onSuccess: ({ sentTo }) => setNotice(`Link sent to ${sentTo}.`) }),
  );
  const reissue = useMutation(
    trpc.project.clientLinkReissue.mutationOptions({
      onSuccess: ({ sentTo }) => {
        setNotice(`New link sent to ${sentTo}. Earlier links no longer work.`);
        return onChange();
      },
    }),
  );
  const preview = useQuery({
    ...trpc.project.clientPreview.queryOptions({ teamSlug, projectId }),
    enabled: previewOpen,
  });
  const busy = add.isPending || remove.isPending || sendLink.isPending || reissue.isPending;
  const error = add.error ?? remove.error ?? sendLink.error ?? reissue.error;

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email.trim() === "" || busy) return;
    add.mutate({ teamSlug, projectId, email, name });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Clients</h2>
        <Button variant="outline" size="sm" onClick={() => setPreviewOpen((open) => !open)} aria-expanded={previewOpen}>
          {previewOpen ? "Close the preview" : "Preview as client"}
        </Button>
      </div>
      <ul className="space-y-2">
        {contacts.map((contact) => {
          const hasEmail = contact.identities.some((i) => i.kind === "email");
          return (
            <li key={contact.id} className="space-y-2 panel p-3">
              <p className="font-medium">
                {contact.name}
                {contact.isPrimary ? <span className="ml-2 text-xs text-muted-foreground">Primary</span> : null}
              </p>
              <ul className="space-y-1 text-sm">
                {contact.identities.map((identity) => (
                  <li key={`${identity.kind}:${identity.value}`} className="flex flex-wrap items-center gap-2">
                    <span className="break-all">
                      {identity.kind === "discord" ? `Discord ${identity.value}` : identity.value}
                    </span>
                    <span className={identity.verified ? "text-xs font-medium" : "text-xs text-muted-foreground"}>
                      {identity.verified ? "Verified" : "Not verified"}
                    </span>
                  </li>
                ))}
              </ul>
              {manages ? (
                <div className="flex flex-wrap gap-2">
                  {hasEmail ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => sendLink.mutate({ teamSlug, projectId, contactId: contact.id })}
                    >
                      Email link
                    </Button>
                  ) : null}
                  {hasEmail ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Send ${contact.name} a new link? Every link they have now stops working.`)) {
                          reissue.mutate({ teamSlug, projectId, contactId: contact.id });
                        }
                      }}
                    >
                      Reissue link
                    </Button>
                  ) : null}
                  {contacts.length > 1 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Remove ${contact.name} from this project? Their links stop working.`)) {
                          remove.mutate({ teamSlug, projectId, contactId: contact.id });
                        }
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {manages ? (
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor="client-add-email">Add a client by email</Label>
            <Input
              id="client-add-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-add-name">Name</Label>
            <Input id="client-add-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
          </div>
          <Button type="submit" disabled={busy || email.trim() === ""}>
            Add
          </Button>
        </form>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : null}
      {previewOpen ? (
        <div className="space-y-2 rounded-lg border border-dashed p-4">
          <p className="text-sm text-muted-foreground">What the client sees. Nothing here can be clicked.</p>
          {preview.data ? (
            <ClientProjectView
              data={preview.data}
              actions={null}
              fileUrl={async (deliveryId) =>
                (await trpcClient.project.deliveryFileUrl.query({ teamSlug, projectId, deliveryId })).url
              }
            />
          ) : preview.isError ? (
            <p className="text-sm text-destructive">{preview.error.message}</p>
          ) : (
            <Loader />
          )}
        </div>
      ) : null}
    </section>
  );
}
