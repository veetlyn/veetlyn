// Who a quote is for and who wrote it. `freelancerId` is the member who does the work and is paid for it; `authorId`
// is who prepared it, which differs when a manager quotes for a freelancer ("team" quoting mode). The author is
// nullable (older rows, or the account was deleted), so it is never guessed.
type Member = { id: string; name: string };

const FORMER_MEMBER = "A former member";

export function quoteAttribution(quote: { freelancerId: string; authorId: string | null }, members: readonly Member[]) {
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? FORMER_MEMBER;
  return {
    quotedFor: nameOf(quote.freelancerId),
    preparedBy: quote.authorId && quote.authorId !== quote.freelancerId ? nameOf(quote.authorId) : null,
  };
}

// Open quoting lets several freelancers bid on one request; the client picks one.
export function competingProposalCount(quotes: readonly { status: string; freelancerId: string }[]): number {
  return new Set(quotes.filter((quote) => quote.status === "proposed").map((quote) => quote.freelancerId)).size;
}
