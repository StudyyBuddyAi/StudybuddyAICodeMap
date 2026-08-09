type QueryResult = { data: unknown; error: null };

/**
 * Postgrest builders are chainable and awaitable, so the stub returns itself for
 * any method and resolves to an empty result when awaited. This covers every
 * `.from(...).select(...).eq(...)` shape in the app without enumerating them.
 */
function queryBuilder(result: QueryResult) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "then") {
          return (onFulfilled: unknown, onRejected: unknown) =>
            Promise.resolve(result).then(
              onFulfilled as never,
              onRejected as never
            );
        }
        return () => queryBuilder(result);
      },
    }
  );
}

/**
 * Stands in for the real client in unit tests. Reports no session, so useAuth
 * settles to a signed-out user and the hooks fall back to their localStorage
 * paths instead of querying the server.
 */
export function createSupabaseStub() {
  const empty = { data: null, error: null };
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      // useAuth unsubscribes on unmount, so the nesting here matters.
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      signInAnonymously: async () => ({
        data: { session: null, user: null },
        error: null,
      }),
      signUp: async () => empty,
      signInWithPassword: async () => empty,
      signOut: async () => ({ error: null }),
      updateUser: async () => empty,
      verifyOtp: async () => empty,
      resend: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
    },
    from: () => queryBuilder({ data: [], error: null }),
    rpc: () => queryBuilder({ data: null, error: null }),
  };
}
