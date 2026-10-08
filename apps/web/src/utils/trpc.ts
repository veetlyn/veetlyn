import type { AppRouter } from "@jendal-workspace/api/routers/index";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // A polled page keeps its last data on a failed poll; a toast per missed poll would pile up.
      if (query.meta?.quietRefetchErrors === true && query.state.data !== undefined) return;
      toast.error(error.message, {
        action: {
          label: "retry",
          onClick: () => {
            query.invalidate();
          },
        },
      });
    },
  }),
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/trpc",
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
